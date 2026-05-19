export const handler = async (event:any) => {

  const body = JSON.parse(event.body || "{}");

  // Discord verification handshake
  if(body.type === 1){
      return {
          statusCode:200,
          headers:{
              "Content-Type":"application/json"
          },
          body:JSON.stringify({
              type:1
          })
      };
  }

  const path = event.requestContext.http.path;
  const method = event.requestContext.http.method;

  if(path === "/health" && method==="GET"){
      return {
          statusCode:200,
          body:JSON.stringify({
              status:"ok"
          })
      };
  }

  if(path === "/discord-interactions"){

      return {
          statusCode:200,
          headers:{
              "Content-Type":"application/json"
          },
          body:JSON.stringify({
              type:4,
              data:{
                  content:"✅ System online"
              }
          })
      };
  }

  return {
      statusCode:404,
      body:"Not Found"
  };
};