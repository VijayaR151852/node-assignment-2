const express = require("express");
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");
const path = require("path");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const app = express();
app.use(express.json());

const dbPath = path.join(__dirname, "twitterClone.db");
let db = null;

const initialize = async () => {
  try {
    db = await open({ filename: dbPath, driver: sqlite3.Database });
    app.listen(3000, () => {
      console.log("Server Started");
    });
  } catch (e) {
    console.log(e.message);
    process.exit(1);
  }
};
initialize();

function printTweet(eachTweet) {
  return {
    username: eachTweet.username,
    tweet: eachTweet.tweet,
    dateTime: eachTweet.date_time,
  };
}

function authenticateToken(request, response, next) {
  let jwtToken;
  const authHeader = request.headers["authorization"];
  if (authHeader !== undefined) {
    jwtToken = authHeader.split(" ")[1];
  }
  if (jwtToken === undefined) {
    response.status(401);
    response.send("Invalid JWT Token");
  } else {
    jwt.verify(jwtToken, "SECRET", async (error, payload) => {
      if (error) {
        response.status(401);
        response.send("Invalid JWT Token");
      } else {
        request.username = payload.username;
        next();
      }
    });
  }
}

app.post("/register/", async (request, response) => {
  const { username, password, name, gender } = request.body;
  const hashedPassword = await bcrypt.hash(request.body.password, 10);
  const queryGet = `select * from user where username='${username}'`;
  const result = await db.get(queryGet);
  if (result !== undefined) {
    response.status(400);
    response.send("User already exists");
  } else if (password.length < 6) {
    response.status(400);
    response.send("Password is too short");
  } else {
    const queryPost = `insert into user(username, password, name, gender) 
      values('${username}','${hashedPassword}','${name}','${gender}')`;
    await db.run(queryPost);
    response.status(200);
    response.send("User created successfully");
  }
});

app.post("/login/", async (request, response) => {
  const { username, password } = request.body;
  const queryGet = `select * from user where username='${username}'`;
  const result = await db.get(queryGet);
  if (result === undefined) {
    response.status(400);
    response.send("Invalid user");
  } else {
    const isPasswordCorrect = await bcrypt.compare(password, result.password);
    if (isPasswordCorrect) {
      const payload = {
        username: username,
      };
      const jwtToken = jwt.sign(payload, "SECRET");
      response.send({ jwtToken });
    } else {
      response.status(400);
      response.send("Invalid password");
    }
  }
});

app.get("/user/tweets/feed/", authenticateToken, async (request, response) => {
  const { username } = request;
  const queryGet = `select user_id from user where username='${username}'`;
  const dbUser = await db.get(queryGet);
  const queryTweets = `select u2.username,tweet,date_time from (user as u1 inner join follower on u1.user_id=follower.follower_user_id) AS T
  inner join user as u2 on T.following_user_id=u2.user_id inner join tweet on T.following_user_id=tweet.user_id
  where T.user_id=${dbUser.user_id} order by date_time desc limit 4`;
  let result = await db.all(queryTweets);
  let myArray = result.map((eachTweet) => printTweet(eachTweet));
  response.send(myArray);
});

app.get("/user/following/", authenticateToken, async (request, response) => {
  const { username } = request;
  const queryGet = `select user_id from user where username='${username}'`;
  const dbUser = await db.get(queryGet);
  const queryFollowing = `select u2.name from (user as u1 inner join follower on u1.user_id=follower.follower_user_id) AS T
  inner join user as u2 on T.following_user_id=u2.user_id
  where T.user_id=${dbUser.user_id}`;

  let result = await db.all(queryFollowing);
  response.send(result);
});

app.get("/user/followers/", authenticateToken, async (request, response) => {
  const { username } = request;
  const queryGet = `select user_id from user where username='${username}'`;
  const dbUser = await db.get(queryGet);
  const queryFollowing = `select u2.name from (user as u1 inner join follower on u1.user_id=follower.following_user_id) AS T
  inner join user as u2 on T.follower_user_id=u2.user_id
  where T.user_id=${dbUser.user_id}`;
  let result = await db.all(queryFollowing);
  response.send(result);
});

app.get("/tweets/:tweetId/", authenticateToken, async (request, response) => {
  const { username } = request;
  const { tweetId } = request.params;
  const queryGet = `select user_id from user where username='${username}'`;
  const dbUser = await db.get(queryGet);
  const queryTweets = `select tweet.tweet,count() as likes,(select count() from (user inner  join follower on user_id=follower_user_id) as T
    inner join tweet on T.following_user_id=tweet.user_id inner join reply on reply.tweet_id=tweet.tweet_id
    where user.user_id=${dbUser.user_id} and tweet.tweet_id=${tweetId} group by tweet.tweet_id) as replies,tweet.date_time from (user inner  join follower on user_id=follower_user_id) as T
    inner join tweet on T.following_user_id=tweet.user_id inner join like on like.tweet_id=tweet.tweet_id
    where user.user_id=${dbUser.user_id} and tweet.tweet_id=${tweetId} group by tweet.tweet_id;`;
  const result = await db.get(queryTweets);
  if (result === undefined) {
    response.status(401);
    response.send("Invalid Request");
  } else {
    response.send({
      tweet: result.tweet,
      likes: result.likes,
      replies: result.replies,
      dateTime: result.date_time,
    });
  }
});

app.delete(
  "/tweets/:tweetId/",
  authenticateToken,
  async (request, response) => {
    const { username } = request;
    const { tweetId } = request.params;
    const queryGet = `select user_id from user where username='${username}'`;
    const dbUser = await db.get(queryGet);
    const queryGetTweet = `select * from tweet where user_id=${dbUser.user_id} and tweet_id=${tweetId}`;
    const result = await db.get(queryGetTweet);
    if (result === undefined) {
      response.status(401);
      response.send("Invalid Request");
    } else {
      const queryDelete = `delete from tweet where user_id=${dbUser.user_id} and tweet_id=${tweetId}`;
      await db.run(queryDelete);
      response.send("Tweet Removed");
    }
  }
);

app.post("/user/tweets/", authenticateToken, async (request, response) => {
  const { username } = request;
  const { tweet } = request.body;
  const queryGet = `select user_id from user where username='${username}'`;
  const dbUser = await db.get(queryGet);
  const d = new Date();
  const date = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()} ${d.getHours()}:${d.getMinutes()}:${d.getSeconds()}`;
  const queryUpdate = `insert into tweet(tweet,user_id,date_time) 
  values('${tweet}',${dbUser.user_id},'${date}')`;
  await db.run(queryUpdate);
  response.send("Created a Tweet");
});

app.get("/user/tweets/", authenticateToken, async (request, response) => {
  const { username } = request;
  const queryGet = `select user_id from user where username='${username}'`;
  const dbUser = await db.get(queryGet);
  const queryTweets = `select tweet,count() as likes,(select count() from tweet inner join reply on tweet.tweet_id=reply.tweet_id where tweet.user_id=${dbUser.user_id} group by tweet.tweet_id) as replies,tweet.date_time from tweet inner join like on like.tweet_id=tweet.tweet_id where tweet.user_id=${dbUser.user_id} group by tweet.tweet_id`;
  const result = await db.all(queryTweets);
  let myArray = result.map((eachTweet) => {
    return {
      tweet: eachTweet.tweet,
      likes: eachTweet.likes,
      replies: eachTweet.replies,
      dateTime: eachTweet.date_time,
    };
  });
  response.send(myArray);
});

app.get(
  "/tweets/:tweetId/replies/",
  authenticateToken,
  async (request, response) => {
    const { tweetId } = request.params;
    const { username } = request;
    const queryGet = `select user_id from user where username='${username}'`;
    const dbUser = await db.get(queryGet);
    const queryReplies = `select u2.name,reply.reply from (user as u1 inner join follower on u1.user_id=follower.follower_user_id) as t
    inner join tweet on t.following_user_id=tweet.user_id inner join reply on reply.tweet_id=tweet.tweet_id inner join user as u2 on reply.user_id=u2.user_id where u1.user_id=${dbUser.user_id} and tweet.tweet_id=${tweetId}`;
    const result = await db.all(queryReplies);
    if (result.length === 0) {
      response.status(401);
      response.send("Invalid Request");
    } else {
      response.send({
        replies: result,
      });
    }
  }
);

app.get(
  "/tweets/:tweetId/likes/",
  authenticateToken,
  async (request, response) => {
    const { tweetId } = request.params;
    const { username } = request;
    const queryGet = `select user_id from user where username='${username}'`;
    const dbUser = await db.get(queryGet);
    const queryLikes = `select u2.username from(user as u1 inner join follower on u1.user_id=follower.follower_user_id) as t
    inner join tweet on t.following_user_id=tweet.user_id inner join like on like.tweet_id=tweet.tweet_id inner join user as u2 on like.user_id=u2.user_id where u1.user_id=${dbUser.user_id} and tweet.tweet_id=${tweetId}`;
    const result = await db.all(queryLikes);
    if (result.length === 0) {
      response.status(401);
      response.send("Invalid Request");
    } else {
      const myArray = result.map((item) => item.username);
      response.send({
        likes: myArray,
      });
    }
  }
);
module.exports = app;
