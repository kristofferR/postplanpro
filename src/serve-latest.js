// PostplanPro: the server entrypoint. Serves Postplan and exits once main has
// moved past the running commit, so Docker restarts the container and its
// start command installs the new one (see README, "Deploying").
import "./server.js";

const MAIN_SHA_URL = "https://api.github.com/repos/kristofferR/postplanpro/commits/main";

const running = process.env.POSTPLAN_RUNNING_REF;
const intervalMs = Number(process.env.POSTPLAN_FOLLOW_INTERVAL_MS || 10 * 60_000);

if (running) {
  setInterval(async () => {
    try {
      const response = await fetch(MAIN_SHA_URL, { headers: { accept: "application/vnd.github.sha" } });
      const latest = response.ok ? (await response.text()).trim() : "";
      if (/^[0-9a-f]{40}$/.test(latest) && latest !== running) {
        console.log(`main moved to ${latest}; exiting so the container deploys it`);
        process.exit(0);
      }
    } catch {
      // GitHub unreachable or rate-limited: keep serving and retry next interval.
    }
  }, intervalMs);
}
