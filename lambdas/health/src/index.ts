import nacl from "tweetnacl";

declare const Buffer: any;
declare const process: {
    env: {
        DISCORD_PUBLIC_KEY?: string;
    };
};

const jsonHeaders = {
    "Content-Type": "application/json"
};

const hexToUint8Array = (hex: string) => {
    if(hex.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(hex)){
        throw new Error("Invalid hex value");
    }

    const bytes = new Uint8Array(hex.length / 2);
    for(let i = 0; i < bytes.length; i++){
        bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    }

    return bytes;
};

const getHeader = (headers: Record<string, string | undefined> | undefined, name: string) => {
    if(!headers){
        return undefined;
    }

    return headers[name] ?? headers[name.toLowerCase()] ?? headers[name.toUpperCase()];
};

const getRawBody = (event: any) => {
    const body = event.body ?? "";

    if(event.isBase64Encoded){
        return Buffer.from(body, "base64").toString("utf8");
    }

    return body;
};

const isValidDiscordRequest = (event: any, rawBody: string) => {
    const publicKey = process.env.DISCORD_PUBLIC_KEY;
    const signature = getHeader(event.headers, "x-signature-ed25519");
    const timestamp = getHeader(event.headers, "x-signature-timestamp");

    if(!publicKey || !signature || !timestamp){
        return false;
    }

    try{
        const message = new TextEncoder().encode(timestamp + rawBody);
        return nacl.sign.detached.verify(
            message,
            hexToUint8Array(signature),
            hexToUint8Array(publicKey)
        );
    }catch{
        return false;
    }
};

export const handler = async (event:any) => {

    const path = event.requestContext?.http?.path;
    const method = event.requestContext?.http?.method;

    // Health endpoint
    if(path === "/health" && method==="GET"){
        return{
            statusCode:200,
            body:JSON.stringify({
                status:"ok"
            })
        };
    }

    // Discord endpoint
    if(path === "/discord-interactions" && method === "POST"){
        const rawBody = getRawBody(event);

        if(!isValidDiscordRequest(event, rawBody)){
            return{
                statusCode:401,
                body:"Invalid request signature"
            };
        }

        const body = JSON.parse(rawBody || "{}");

        // Discord Ping verification
        if(body.type===1){

            return{
                statusCode:200,
                headers:jsonHeaders,
                body:JSON.stringify({
                    type:1
                })
            };
        }

        return{
            statusCode:200,
            headers:jsonHeaders,
            body:JSON.stringify({
                type:4,
                data:{
                    content:"✅ System online"
                }
            })
        };
    }

    return{
        statusCode:404,
        body:"Not Found"
    };
};
