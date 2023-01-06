const Ajv=require("ajv");
const ajv=new Ajv({allErrors: true});
console.log(ajv);
const clientPromise = require('./mongo-client');

const readSchemaFromDB = async function (schemaToCheck){
  try{
    const client = await clientPromise;
    const db = client.db();
    const collections = await db.collection("schemas");
    if (!collections) {
     throw(`Collection  is not found`);
    }

    const schema = await collections.findOne({
      collectionName: { $eq: schemaToCheck },
    });
    return schema["jsonSchema"];

  }
  catch(err){
    console.error(err);
  }
};


/**
 * 
 * @param {object} data 
 * @returns {boolean}
 */
const validateChampionSchema = async function (data){
  try{
    const championSchema = await readSchemaFromDB("champions");
    const validate =await ajv.compile(championSchema);
    const valid = validate(data);
    if(!valid) throw validate.errors;
    return true;
  }catch(err){
    console.error({Error:err});
    return false;
  }
    
};



  module.exports = {validateChampionSchema};
