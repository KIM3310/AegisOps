import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { app } from "../server/index";

const iterations = Number.parseInt(process.env.AEGISOPS_LOAD_ITERATIONS || "6", 10);
const operatorToken = String(process.env.AEGISOPS_OPERATOR_TOKEN || "").trim();

function buildHeaders() {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (operatorToken) {
    headers.authorization = `Bearer ${operatorToken}`;
  }
  return headers;
}

async function main() {
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo | null;
  if (!address) {
    throw new Error("failed to resolve aegisops load test port");
  }
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const payload = {
      logs: "checkout workers returned intermittent 502 responses during an upstream deploy window",
      images: [],
    };

    for (let index = 0; index < Math.max(1, iterations); index += 1) {
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
          persistence: scorecard.persistence,
          operatorAuth: scorecard.operatorAuth,
        },
        null,
        2
      )
    );
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
