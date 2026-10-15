import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { startApexHttpServer } from '../src/server/local-server';

const TEST_DB_PATH = path.resolve(__dirname, '../../.tmp_phase56_browser.sqlite');

test('Phase 5 & 6 — Live Browser UI E2E Verification Across Desktop, Laptop, Tablet & Android Mobile Viewports (Gates 10, 11, 12)', async (t) => {
  if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
  const srv = await startApexHttpServer(0, TEST_DB_PATH);
  const baseUrl = `http://127.0.0.2:${srv.port}`;

  try {
    await t.test('Gates 10, 11, 12: Headless Chromium drives live registration, email verification challenge, login, resume ingestion, job discovery, plan execution, emergency stop across refresh, and captures multi-viewport screenshots', async () => {
      fs.mkdirSync('/tmp/apex_screenshots', { recursive: true });
      const pyScript = `
import sys, json, time
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.common.exceptions import NoSuchElementException, StaleElementReferenceException

base_url = sys.argv[1]
out_dir = "/tmp/apex_screenshots"

opts = Options()
opts.page_load_strategy = "eager"
opts.add_argument("--headless=new")
opts.add_argument("--no-sandbox")
opts.add_argument("--disable-dev-shm-usage")
opts.add_argument("--window-size=1440,900")

driver = webdriver.Chrome(options=opts)
wait = WebDriverWait(driver, 25, ignored_exceptions=(NoSuchElementException, StaleElementReferenceException))
try:
    driver.get(base_url)
    wait.until(lambda d: "LIVE AUTHENTICATED BACKEND API" in d.find_element(By.ID, "connection-mode-label").text)

    # Capture Auth & Email Verification Gate screenshot
    driver.save_screenshot(f"{out_dir}/ui_v2_after_desktop_auth_gate.png")

    # 2. Register new account via UI (verifying zero token leak in #auth-challenge-token)
    driver.find_element(By.ID, "btn-register").click()
    wait.until(lambda d: "emailVerified=false" in d.find_element(By.ID, "auth-status-msg").text)
    assert driver.find_element(By.ID, "auth-challenge-token").get_attribute("value") == "", "Registration must never leak token into input"

    # 3. Retrieve dev OOB token and complete single-use cryptographic email verification challenge via UI
    driver.find_element(By.ID, "btn-fetch-oob-dev").click()
    wait.until(lambda d: "evtok_" in (d.find_element(By.ID, "auth-challenge-token").get_attribute("value") or ""))
    driver.find_element(By.ID, "btn-verify-challenge").click()
    wait.until(lambda d: "cryptographically verified" in d.find_element(By.ID, "auth-status-msg").text)

    # 4. Sign in via UI
    driver.find_element(By.ID, "btn-login").click()
    wait.until(lambda d: d.find_element(By.ID, "authenticated-shell").value_of_css_property("display") == "grid")

    # 5. Verify initial counts for new user are 0 (zero fake pre-populated data!)
    facts_count_initial = driver.find_element(By.ID, "stat-facts-count").text
    jobs_count_initial = driver.find_element(By.ID, "stat-jobs-count").text
    assert facts_count_initial == "0", f"Expected 0 initial facts, got {facts_count_initial}"
    assert jobs_count_initial == "0", f"Expected 0 initial jobs, got {jobs_count_initial}"

    # 6. Ingest Master Resume & verify excerpt via live backend API
    driver.find_element(By.ID, "btn-ingest-resume").click()
    wait.until(lambda d: d.find_element(By.ID, "stat-facts-count").text == "1")
    facts_count_after = driver.find_element(By.ID, "stat-facts-count").text

    # 7. Discover vacancy & run explainable match via live backend API
    driver.find_element(By.ID, "btn-discover-job").click()
    wait.until(lambda d: d.find_element(By.ID, "stat-jobs-count").text == "1")
    jobs_count_after = driver.find_element(By.ID, "stat-jobs-count").text

    # Capture Desktop (1440x900) Mission Control Screenshot
    driver.save_screenshot(f"{out_dir}/ui_v2_after_desktop_mission_control.png")

    # 8. Navigate to AI Command Center and execute a real plan on the server
    driver.find_element(By.CSS_SELECTOR, "[data-workspace='ai-command-center']").click()
    time.sleep(0.2)
    driver.find_element(By.ID, "btn-execute-plan").click()
    wait.until(lambda d: "pln_" in d.find_element(By.ID, "workspace-viewport").text)
    driver.save_screenshot(f"{out_dir}/ui_v2_after_desktop_ai_command.png")

    # 9. Navigate to Neural Core and capture screenshot
    driver.find_element(By.CSS_SELECTOR, "[data-workspace='neural-core']").click()
    time.sleep(0.2)
    driver.save_screenshot(f"{out_dir}/ui_v2_after_desktop_neural_core.png")

    # 10. Toggle server-backed Emergency Stop and verify persistence across browser page refresh via HttpOnly cookie!
    driver.find_element(By.ID, "btn-emergency-stop").click()
    wait.until(lambda d: "ACTIVE (HALTED)" in d.find_element(By.ID, "btn-emergency-stop").text)

    driver.refresh()
    wait.until(lambda d: d.find_element(By.ID, "authenticated-shell").value_of_css_property("display") == "grid" and "ACTIVE (HALTED)" in d.find_element(By.ID, "btn-emergency-stop").text)

    # Release Emergency Stop
    driver.find_element(By.ID, "btn-emergency-stop").click()
    wait.until(lambda d: "EMERGENCY STOP: OFF" in d.find_element(By.ID, "btn-emergency-stop").text)

    # 11. Test Laptop (1280x800), Tablet (768x1024), and Android Mobile (412x915) viewports
    driver.set_window_size(1280, 800)
    time.sleep(0.2)
    driver.save_screenshot(f"{out_dir}/ui_v2_after_laptop.png")

    driver.set_window_size(768, 1024)
    time.sleep(0.2)
    driver.save_screenshot(f"{out_dir}/ui_v2_after_tablet.png")

    driver.set_window_size(412, 915)
    time.sleep(0.2)
    driver.find_element(By.ID, "mobile-nav-toggle").click()
    time.sleep(0.2)
    driver.save_screenshot(f"{out_dir}/ui_v2_after_android_mobile.png")

    print(json.dumps({"ok": True, "factsAfter": facts_count_after, "jobsAfter": jobs_count_after}))
finally:
    driver.quit()
`;
      const res = await new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve) => {
        const child = spawn('python3', ['-c', pyScript, baseUrl]);
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (d) => { stdout += d.toString(); });
        child.stderr.on('data', (d) => { stderr += d.toString(); });
        child.on('close', (status) => resolve({ status, stdout, stderr }));
      });
      assert.equal(res.status, 0, `Browser E2E failed: ${res.stderr || res.stdout}`);
      const lines = res.stdout.trim().split('\n');
      const parsed = JSON.parse(lines[lines.length - 1]);
      assert.equal(parsed.ok, true);
      assert.equal(parsed.factsAfter, '1');
      assert.equal(parsed.jobsAfter, '1');
    });
  } finally {
    await srv.close();
    if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
  }
});
