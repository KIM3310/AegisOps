import http from "k6/http";
import { check, sleep } from "k6";

export const options = {
  scenarios: {
    runtime_scorecard: {
      executor: "shared-iterations",
      vus: Number(__ENV.K6_VUS || 4),
      iterations: Number(__ENV.K6_ITERATIONS || 20),
      maxDuration: __ENV.K6_MAX_DURATION || "60s",
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.05"],
    http_req_duration: ["p(95)<3000"],
  },
};

const baseUrl = (__ENV.AEGISOPS_BASE_URL || "http://127.0.0.1:8787").replace(/\/$/, "");
const operatorToken = (__ENV.AEGISOPS_OPERATOR_TOKEN || "").trim();
const operatorRole = (__ENV.AEGISOPS_OPERATOR_ROLE || "").trim();

function buildHeaders() {
  const headers = { "Content-Type": "application/json" };
  if (operatorToken) {
    headers.Authorization = `Bearer ${operatorToken}`;
  }
  if (operatorRole) {
    headers["x-operator-role"] = operatorRole;
  }
  return headers;
}

export default function () {
  const headers = buildHeaders();
  const analyzeResponse = http.post(
    `${baseUrl}/api/analyze`,
    JSON.stringify({
      images: [],
      logs: "checkout workers returned intermittent 502 responses during a coordinated deploy window",
    }),
    { headers }
  );
  check(analyzeResponse, {
    "analyze status 200": (response) => response.status === 200,
  });

  const scorecardResponse = http.get(`${baseUrl}/api/runtime/scorecard?focus=reliability`, {
    headers,
  });
  check(scorecardResponse, {
    "scorecard status 200": (response) => response.status === 200,
    "scorecard contains summary": (response) => Boolean(response.json("summary.totalRequests")),
  });

  sleep(0.2);
}
