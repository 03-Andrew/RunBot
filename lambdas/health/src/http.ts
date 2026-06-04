declare const Buffer: any;

export const getHeader = (
  headers: Record<string, string | undefined> | undefined,
  name: string
) => {
  if (!headers) {
    return undefined;
  }

  return (
    headers[name] ?? headers[name.toLowerCase()] ?? headers[name.toUpperCase()]
  );
};

export const getRawBody = (event: { body?: string | null; isBase64Encoded?: boolean }) => {
  const body = event.body ?? "";

  if (event.isBase64Encoded) {
    return Buffer.from(body, "base64").toString("utf8");
  }

  return body;
};

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
