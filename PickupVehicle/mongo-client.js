"use strict";
// Import the dependency.
const { MongoClient } = require('mongodb');
// Export a module-scoped MongoClient promise. By doing this in a separate
// module, the client can be shared across functions.
const client = new MongoClient(process.env.MONGODB,
  { useNewUrlParser: true,  useUnifiedTopology: true });
module.exports = client.connect(); 