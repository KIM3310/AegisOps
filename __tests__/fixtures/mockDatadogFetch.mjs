let monitorIndex = 0;

function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: {
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

globalThis.fetch = async (input, init = {}) => {
  const url = String(input);
  const method = String(init.method ?? "GET").toUpperCase();

  if (process.env.DD_DATADOG_TEST_REJECT === "1") {
    return new Response(
      `${process.env.DD_API_KEY}:${process.env.DD_APP_KEY}`,
      {
        status: 403,
        headers: { "x-request-id": "safe-test-request" },
      }
    );
  }

  if (url.endsWith("/api/v1/validate")) {
    return jsonResponse({ valid: true });
  }
  if (url.endsWith("/api/v1/dashboard") && method === "GET") {
    return jsonResponse({ dashboards: [] });
  }
  if (url.endsWith("/api/v1/dashboard") && method === "POST") {
    const body = JSON.parse(String(init.body));
    return jsonResponse({ id: "dashboard-test-id", title: body.title });
  }
  if (url.endsWith("/api/v1/monitor") && method === "GET") {
    return jsonResponse([]);
  }
  if (url.endsWith("/api/v1/monitor") && method === "POST") {
    const body = JSON.parse(String(init.body));
    monitorIndex += 1;
    return jsonResponse({ id: `monitor-test-${monitorIndex}`, name: body.name });
  }

  return jsonResponse({ error: "unexpected test request" }, { status: 500 });
};
