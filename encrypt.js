console.log('Loading function');

exports.handler = async (event, context) => {
const secret = process.env.value1

return secret
};
