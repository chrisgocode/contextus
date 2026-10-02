// PROTOTYPE helper — records the scramble → reveal on a phone viewport.
import { chromium, devices } from "@playwright/test";
const base = "http://localhost:3123";
const browser = await chromium.launch();
const host = await (await browser.newContext()).newPage();
await host.goto(base + "/");
await host.getByRole("button", { name: "Create room" }).click();
await host.waitForURL(/\/r\/[A-Z0-9]{6}$/, { timeout: 90000 });
const url = host.url();
const setup = await browser.newContext({ ...devices["iPhone 14 Pro"], colorScheme: "dark" });
const p0 = await setup.newPage();
await p0.goto(url);
await p0.getByRole("button", { name: "Join as guest" }).click();
await host.getByRole("button", { name: "Start game" }).click({ timeout: 90000 });
await p0.getByPlaceholder("Type a word…").waitFor({ timeout: 90000 });
for (const w of ["cake", "pudding", "custard"]) {
  await p0.getByPlaceholder("Type a word…").fill(w);
  await p0.getByRole("button", { name: "Guess" }).click();
  await p0.waitForTimeout(1500);
}
// Warm the route so the recording doesn't start on a compile.
await p0.goto(`${url}?variant=C&req=idle&copy=scramble`);
await p0.getByPlaceholder("Type a word…").waitFor({ timeout: 90000 });
const state = await setup.storageState();
const rec = await browser.newContext({
  ...devices["iPhone 14 Pro"], colorScheme: "dark", storageState: state,
  recordVideo: { dir: "/tmp/proto-video", size: { width: 393, height: 560 } },
  viewport: { width: 393, height: 560 },
});
const player = await rec.newPage();
await player.goto(`${url}?variant=C&req=idle&copy=scramble`);
await player.getByPlaceholder("Type a word…").waitFor({ timeout: 90000 });
await player.addStyleTag({ content: "nextjs-portal { display: none !important; } .fixed.top-2.z-\\[100\\] { opacity: 0 !important; }" });
await player.waitForTimeout(1200);
await player.getByRole("button", { name: "Request hint" }).click();
await player.waitForTimeout(3500);
await player.locator("select").selectOption("approved");
await player.waitForTimeout(4500);
const video = player.video();
await rec.close();
console.log(await video.path());
await host.getByRole("button", { name: /^End( room)?$/ }).click();
await host.waitForTimeout(1500);
await browser.close();
