"use strict";
// Import the dependency.
const { MongoClient } = require('mongodb');
// Export a module-scoped MongoClient promise. By doing this in a separate
// module, the client can be shared across functions.
const dbString = `mongodb+srv://AKIAQWSFSXC5XIVL53XP:HJ6E300oM6GHRigAi%2BVuKctIPprkdKgbRQop%2FIWO@london-cluster-vams.wia8y.mongodb.net/?authSource=%24external&authMechanism=MONGODB-AWS&retryWrites=true&w=majority`;

const client = new MongoClient(dbString,
  { useNewUrlParser: true,  useUnifiedTopology: true });
const cachedDB = null;

const connectToDB = (database)=>{
  return new Promise((resolve,reject)=>{
    if(cachedDB && cachedDB?.serverConfig?.isConnected() ){
      console.log("cached Database is there");
      resolve(cachedDB);
    }
    client.connect().then((conn)=>{
      cachedDB = conn.db(database);
      resolve(cachedDB);
    })
  })
};
module.exports = {connectToDB};