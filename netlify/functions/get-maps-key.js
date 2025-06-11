exports.handler = async function() {
  return {
    statusCode: 200,
    body: JSON.stringify({ apiKey: process.env.VITE_Maps_API_KEY })
  };
};