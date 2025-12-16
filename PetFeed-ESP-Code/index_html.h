const char INDEX_HTML[] PROGMEM = R"rawliteral(
<!DOCTYPE html>
<html lang="en">
<head>
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Smart Feeder</title>

<style>
:root {
  --bg: #05070c;
  --card: #0e1424;
  --primary: #3b82f6;
  --primary-glow: rgba(59,130,246,0.55);
  --success: #22c55e;
  --danger: #ef4444;
  --text: #e5e7eb;
  --muted: #9ca3af;
  --border: #1f2937;
  --radius: 22px;
}

* {
  box-sizing: border-box;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
}

html, body {
  margin: 0;
  padding: 0;
  background: var(--bg);
  min-height: 100vh;
}

body {
  display: flex;
  justify-content: center;
  padding: 24px;
  color: var(--text);
}

.container {
  width: 100%;
  max-width: 420px;
}

.card {
  background: linear-gradient(180deg, #121a30, #0a0f1f);
  border-radius: var(--radius);
  padding: 28px;
  box-shadow:
    0 0 0 1px rgba(255,255,255,0.03),
    0 30px 60px rgba(0,0,0,0.9);
  margin-bottom: 28px;
}

h1 {
  margin: 0 0 10px;
  font-size: 30px;
  font-weight: 800;
  text-align: center;
}

.subtitle {
  text-align: center;
  color: var(--muted);
  font-size: 14px;
  margin-bottom: 22px;
}

.time-wrap {
  display: flex;
  justify-content: center;
}

input[type="time"] {
  width: 100%;
  max-width: 260px;
  appearance: none;
  -webkit-appearance: none;
  font-size: 22px;
  padding: 14px;
  border-radius: 14px;
  border: 1px solid var(--border);
  background: #020617;
  color: var(--text);
  text-align: center;
  margin-bottom: 20px;
}

button {
  width: 100%;
  border: none;
  border-radius: 16px;
  padding: 16px;
  font-size: 18px;
  font-weight: 700;
  cursor: pointer;
  transition: transform 0.15s ease, box-shadow 0.15s ease;
}

button:active {
  transform: scale(0.97);
}

.primary {
  background: linear-gradient(135deg, #2563eb, #60a5fa);
  box-shadow: 0 0 35px var(--primary-glow);
  color: white;
}

.warning {
  text-align: center;
  color: #fca5a5;
  font-weight: 700;
  font-size: 15px;
  margin-bottom: 18px;
  letter-spacing: 0.5px;
}

.row {
  display: flex;
  gap: 14px;
}

.success {
  background: linear-gradient(135deg, #16a34a, #4ade80);
  box-shadow: 0 0 25px rgba(34,197,94,0.45);
  color: #052e16;
  flex: 1;
}

.danger {
  background: linear-gradient(135deg, #b91c1c, #f87171);
  box-shadow: 0 0 25px rgba(239,68,68,0.45);
  color: #450a0a;
  flex: 1;
}

.secondary {
  margin-top: 18px;
  background: #020617;
  color: var(--muted);
  font-size: 14px;
  padding: 12px;
  border: 1px solid var(--border);
}
</style>
</head>

<body>
<div class="container">

  <div class="card">
    <h1>Feeding Schedule</h1>
    <div class="subtitle">Set your dogs next meal time</div>

    <div class="time-wrap">
      <input type="time" id="setTime">
    </div>

    <button class="primary" onclick="sendTime()">Activate Feeding</button>
  </div>

  <div class="card">
    <div class="warning">
      MANUAL CONTROLS<br>
      Use only when adding food
    </div>

    <div class="row">
      <button class="success" onclick="manualOpen()">Open Lid</button>
      <button class="danger" onclick="manualClose()">Close Lid</button>
    </div>

    <button class="secondary" onclick="cancelActivation()">Cancel Scheduled Feed</button>
  </div>

</div>

<script>
function sendTime() {
  const time = document.getElementById('setTime').value;
  fetch('/activate?time=' + time);
}

function manualOpen() {
  fetch('/manual?state=open');
}

function manualClose() {
  fetch('/manual?state=close');
}

function cancelActivation() {
  fetch('/cancel');
}
</script>
</body>
</html>
)rawliteral";