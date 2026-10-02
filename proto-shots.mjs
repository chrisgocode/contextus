// PROTOTYPE helper — seeds a two-guest room and screenshots each variant.
import { chromium, devices } from "@playwright/test";
const base = "http://localhost:3123";
const browser = await chromium.launch();
const hostCtx = await browser.newContext();
const host = await hostCtx.newPage();
await host.goto(base + "/");
await host.getByRole("button", { name: "Create room" }).click();
await host.waitForURL(/\/r\/[A-Z0-9]{6}$/, { timeout: 60000 });
const url = host.url();
console.log("room", url);
const playerCtx = await browser.newContext({ ...devices["iPhone 14 Pro"], colorScheme: "dark" });
const player = await playerCtx.newPage();
await player.goto(url);
await player.getByRole("button", { name: "Join as guest" }).click();
await host.getByRole("button", { name: "Start game" }).click({ timeout: 60000 });
await player.getByPlaceholder("Type a word…").waitFor({ timeout: 60000 });
for (const w of process.argv.slice(2)) {
  await player.getByPlaceholder("Type a word…").fill(w);
  await player.getByRole("button", { name: "Guess" }).click();
  await player.waitForTimeout(1500);
}
await player.screenshot({ path: "/tmp/proto-shots/current.png" });
await player.getByRole("button", { name: "Request give up" }).click();
await player.waitForTimeout(1500);
await player.screenshot({ path: "/tmp/proto-shots/current-pending.png" });
for (const c of ["verbs", "scramble", "typing", "plain"]) {
  for (const r of ["hint", "both"]) {
    await player.goto(`${url}?variant=C&req=${r}&copy=${c}`);
    await player.getByPlaceholder("Type a word…").waitFor({ timeout: 60000 });
    await player.waitForTimeout(2500);
    await player.addStyleTag({ content: "nextjs-portal, .fixed.top-2.z-\\[100\\] { display: none !important; }" });
    await player.screenshot({ path: `/tmp/proto-shots/copy-${c}-${r}.png`, clip: { x: 0, y: 0, width: 393, height: 560 } });
    if (c === "verbs" && r === "hint") {
      for (const k of [1, 2]) {
        await player.waitForTimeout(2400);
        await player.screenshot({ path: `/tmp/proto-shots/copy-verbs-f${k}.png`, clip: { x: 0, y: 220, width: 393, height: 200 } });
      }
    }
  }
}
await host.getByRole("button", { name: /^End( room)?$/ }).click();
await host.waitForTimeout(2000);
await browser.close();
