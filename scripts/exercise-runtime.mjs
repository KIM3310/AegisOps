const baseUrl = String(process.env.AEGISOPS_API_BASE_URL || "http://127.0.0.1:3001").replace(/\/$/, "");
const operatorToken = String(process.env.AEGISOPS_OPERATOR_TOKEN || "");

function buildHeaders() {
  const headers = { "content-type": "application/json" };
  if (operatorToken) {
    headers.authorization = `Bearer ${operatorToken}`;
  }
  return headers;
}

async function run() {
  const payload = {
    logs: "checkout workers returned intermittent 502 responses during an upstream deploy window",
    images: [],
  };

  for (let index = 0; index < 3; index += 1) {
    const response = await fetch(`${baseUrl}/api/analyze`, {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      throw new Error(`analyze failed (${response.status})`);
    }
    await response.json();
  }

  const scorecardResponse = await fetch(`${baseUrl}/api/runtime/scorecard?focus=reliability`);
  if (!scorecardResponse.ok) {
    throw new Error(`runtime scorecard failed (${scorecardResponse.status})`);
  }
  const scorecard = await scorecardResponse.json();
  console.log(
    JSON.stringify(
      {
        summary: scorecard.summary,
        operatorAuth: scorecard.operatorAuth,
        persistence: {
          path: scorecard.persistence?.path,
          persistedEventCount: scorecard.summary?.persistedEventCount,
        },
      },
      null,
      2
    )
  );
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
