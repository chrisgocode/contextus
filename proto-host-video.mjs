// PROTOTYPE helper — records the host's phone view while a member requests a hint.
import { chromium, devices } from "@playwright/test";
const base = "http://localhost:3123";
const phone = { ...devices["iPhone 14 Pro"], colorScheme: "dark" };
const browser = await chromium.launch();
const setup = await browser.newContext(phone);
const h0 = await setup.newPage();
await h0.goto(base + "/");
await h0.getByRole("button", { name: "Create room" }).click();
await h0.waitForURL(/\/r\/[A-Z0-9]{6}$/, { timeout: 90000 });
const url = h0.url();
const player = await (await browser.newContext(phone)).newPage();
await player.goto(url);
await player.getByRole("button", { name: "Join as guest" }).click();
await h0.getByRole("button", { name: "Start game" }).click({ timeout: 90000 });
await player.getByPlaceholder("Type a word…").waitFor({ timeout: 90000 });
for (const w of ["cake", "pudding", "custard", "muffin", "cinnamon", "pancake", "frost"]) {
  await player.getByPlaceholder("Type a word…").fill(w);
  await player.getByRole("button", { name: "Guess" }).click();
  await player.waitForTimeout(1200);
}
const rec = await browser.newContext({
  ...phone, storageState: await setup.storageState(),
  recordVideo: { dir: "/tmp/proto-host-video", size: { width: 393, height: 852 } },
});
const host = await rec.newPage();
await host.goto(url);
await host.getByPlaceholder("Type a word…").waitFor({ timeout: 90000 });
await host.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
await host.waitForTimeout(1500);
await player.getByRole("button", { name: "Request hint" }).click();
await host.waitForTimeout(3000);
await host.getByRole("button", { name: /pending request/ }).click({ force: true });
await host.waitForTimeout(2000);
await host.getByRole("button", { name: "Approve" }).click();
await host.waitForTimeout(4500);
const video = host.video();
await rec.close();
console.log(await video.path());
await h0.getByRole("button", { name: /^End( room)?$/ }).click();
await h0.waitForTimeout(1500);
await browser.close();
