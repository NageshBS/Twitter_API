const express = require('express')
const { open } = require('sqlite')
const sqlite3 = require('sqlite3')
const path = require('path')
const bcrypt = require('bcrypt')
const jwt = require('jsonwebtoken')

const app = express()

app.use(express.json())

const dbPath = path.join(__dirname, 'twitterClone.db')

const initializeDBAndServer = async () => {
    try {
        db = await open({ filename: dbPath, driver: sqlite3.Database })

        app.listen(3000, () => {
            console.log('Ther server is started at http://localhost:3000/')
        })
    } catch (e) {
        console.log(`Error : ${e.message}`)
        process.exit(1)
    }
}

initializeDBAndServer()

const authenticateToken = (request, response, next) => {
    let jwtToken;
    const authHeader = request.headers["authorization"];

    if (authHeader) {
        jwtToken = authHeader.split(" ")[1]

        jwt.verify(jwtToken, "MY_SECRET_KEY", async (error, payload) => {
            if (error) {
                response.status(400)
                response.send("Invalid JWT Token")
            }
            else {
                request.username = payload.username
                next();
            }
        })
    }
    else {
        response.status(400)
        response.send("Invalid JWT Token")
    }
};


// API 1
app.post('/register/', async (request, response) => {
    const { username, password, name, gender } = request.body

    const userDetailsQuery = `
    SELECT
    * FROM 
    user
    WHERE
    username = '${username}';`
    const userDetails = await db.get(userDetailsQuery)
    if (userDetails === undefined) {
        // console.log('if block')
        if (password.length < 6) {
            // response.status(400)
            response.send('Password is too short')
            process.exit(1)
        }
        const hashedPassword = bcrypt.hash(password, 10)

        const addUserQuery = `
    INSERT INTO user
    (name, username, password, gender)
     values(
      '${name}',
      '${username}',
      '${hashedPassword}',
      '${gender}');
    `

        await db.run(addUserQuery)
        response.status(200)
        response.send('User created successfully')
    } else {
        response.status(400)
        response.send('User already exists')
    }
})

// API 2
app.post("/login", async (request, response) => {
    const { username, password } = request.body;
    const existUserQuery = `select * from user where username = '${username}';`

    const existingUser = await db.get(existUserQuery)

    if (existingUser) {
        console.log(existingUser.user_id)
        const passwordMatch = await bcrypt.compare(password, existingUser.password)

        if (passwordMatch) {
            console.log("Login successfull")

            const payload = { username: username }
            const jwtToken = jwt.sign(payload, "MY_SECRET_KEY")
            response.send({ jwtToken: jwtToken })

        }
        else {
            console.log("Invalid password")
            response.status(400)
            response.send("Invalid password")
        }

    }
    else {
        response.status(400)
        response.send("Invalid user")
    }
});


// API 3
app.get('/user/tweets/feed/', authenticateToken, async (request, response) => {
    const username = request.username
    const userId = await getUserId(username)

    //Query to get the latest tweets
    const tweetQuery =
        `
    SELECT u.username, t.tweet, t.date_time
    FROM
    tweet t, user u
    WHERE
    u.user_id = t.user_id
    AND
    t.user_id in
    (SELECT 
    following_user_id 
    FROM
    follower 
    WHERE
    follower_user_id = ${userId})
    ORDER BY t.date_time DESC LIMIT 4;
    `
    const tweets = await db.all(tweetQuery)
    response.send(tweets)
})

// API 4
app.get('/user/following/', authenticateToken, async (request, response) => {

    const username = request.username
    //Get the user_id of the user
    const user_id = await getUserId(username)

    //Query to get the list of follws
    const query = `
        select u.name 
        from 
        user u, follower f
        where
        f.following_user_id = u.user_id and
        f.follower_user_id = ${user_id}; `
    const followsList = await db.all(query)
    response.send(followsList)

})

// API 5
app.get('/user/followers/', authenticateToken, async (request, response) => {
    const username = request.username
    //Get the user_id of the user
    const userId = await getUserId(username)

    const follwerrQuery =
        `SELECT 
        username 
        FROM user 
        WHERE user_id 
        IN (
        SELECT 
        follower_user_id 
        FROM 
        follower 
        WHERE 
        following_user_id = ${userId}
        );
        `
    const followers = await db.all(follwerrQuery)
    response.send(followers)
})

//API 6
app.get('/tweets/:tweetId/', authenticateToken, async (request, response) => {
    const username = request.username
    const { tweetId } = request.params
    const userId = await getUserId(username)

    const followingQuery =
        `
    select 1 FROM
    follower WHERE 
    follower_user_id = ${userId} AND
    following_user_id = 
    (SELECT user_id from tweet WHERE tweet_id = ${tweetId});
    `
    const isFollowing = await db.get(followingQuery)
    // console.log(isFollowing)

    if (!isFollowing) {
        console.log("not following")
        response.status(401)
        response.send("Invalid Request")
    }
    else {
        console.log("following")
        const countQuery =
            `SELECT
            t.tweet, 
            count(distinct l.user_id) as 'likes', 
            count(distinct r.reply_id) as 'replies', 
            t.date_time as 'date_time'
            FROM
            tweet t, like l, reply r
            WHERE
            t.tweet_id = r.tweet_id AND
            t.tweet_id = l.tweet_id AND
            t.tweet_id = ${tweetId};
            `
        const likeReplyCount = await db.get(countQuery)
        response.send(likeReplyCount)
    }
})

//API 11
app.delete('/tweets/:tweetId/', authenticateToken, async (request, response) => {
    const username = request.username
    const userId = await getUserId(username)
    const { tweetId } = request.params

    //Query to check whether the user is allowed delete the tweet or not
    const allowedQuery =
        `SELECT 1 
        FROM tweet 
        WHERE 
        tweet_id = ${tweetId} AND user_id = ${userId}; `

    const isAllowed = await db.get(allowedQuery)
    if (isAllowed) {
        console.log("Allowed to delete")

        //Delete the tweet
        const deleteQuery =
            `DELETE
            FROM 
            tweet
            where tweet_id = ${tweetId};
            `
        await db.run(deleteQuery)
        response.send("Tweet Removed")
    }
    else {
        console.log("Not allowed to delete")
        response.status(401)
        response.send("Invalid Request")
    }
})




const getUserId = async (username) => {
    const user_id = await db.get(`select user_id from user where username = '${username}';`)
        .then((user) => { return user.user_id })
    return user_id
}

app.get('/', authenticateToken, (request, response) => {

    console.log(request.username)
    response.send("authenticated")
})