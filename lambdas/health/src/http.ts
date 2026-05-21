export const jsonHeaders = {
  "Content-Type": "application/json",
};

export const htmlHeaders = {
  "Content-Type": "text/html",
};

export const textResponse = (statusCode: number, body: string) => ({
  statusCode,
  body,
});

export const jsonResponse = (statusCode: number, body: unknown) => ({
  statusCode,
  headers: jsonHeaders,
  body: JSON.stringify(body),
});

export const htmlResponse = (statusCode: number, body: string) => ({
  statusCode,
  headers: htmlHeaders,
  body,
});

