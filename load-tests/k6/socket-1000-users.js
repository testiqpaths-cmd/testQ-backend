import ws from "k6/ws";
import { check, sleep } from "k6";
import { Counter, Rate, Trend } from "k6/metrics";
import { BASE_URL, getStages, loadFixtures } from "./config.js";

const fixtures = loadFixtures();

const wsConnectMs = new Trend("socket_connect_ms", true);
const wsHandshakeErrors = new Rate("socket_handshake_error_rate");
const wsConnectionsOk = new Counter("socket_connections_ok");

export const options = {
  stages: getStages("stress_1000"),
  thresholds: {
    socket_handshake_error_rate: ["rate<0.02"],
    socket_connect_ms: ["p(95)<2000"],
  },
};

function toWsUrl(httpUrl) {
  const wsBase = httpUrl.replace(/^https:\/\//i, "wss://").replace(/^http:\/\//i, "ws://");
  return `${wsBase}/socket.io/?EIO=4&transport=websocket`;
}

export default function () {
  const user = fixtures.users[(__VU - 1) % fixtures.users.length];
  const url = toWsUrl(BASE_URL);
  const start = Date.now();
  let ackReceived = false;

  const res = ws.connect(url, {}, (socket) => {
    socket.on("message", (msg) => {
      // Engine.IO OPEN packet starts with "0"
      if (msg.startsWith("0")) {
        // Socket.IO v4 CONNECT to /assigned-tests namespace with JWT auth
        socket.send(`40/assigned-tests,${JSON.stringify({ token: user.accessToken })}`);
        return;
      }

      // Socket.IO CONNECT ACK for /assigned-tests starts with "40/assigned-tests,"
      if (msg.startsWith("40/assigned-tests")) {
        ackReceived = true;
        wsConnectionsOk.add(1);
        wsConnectMs.add(Date.now() - start);
        return;
      }

      // Engine.IO server ping ("2") -> reply pong ("3")
      if (msg === "2") {
        socket.send("3");
      }
    });

    socket.on("error", () => {
      wsHandshakeErrors.add(1);
    });

    // Hold socket open for 15s (or until close) to simulate concurrent connected users
    socket.setTimeout(() => {
      socket.close();
    }, 15000);
  });

  const ok = check(res, {
    "websocket status 101": (r) => r && r.status === 101,
    "socket.io /assigned-tests ack": () => ackReceived,
  });

  wsHandshakeErrors.add(!ok);
  sleep(1);
}
