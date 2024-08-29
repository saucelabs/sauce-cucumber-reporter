require('jest');

const { exec } = require('child_process');
const { existsSync } = require('fs');
const path = require('path');
const axios = require('axios');

const jobUrlPattern = /https:\/\/app\.saucelabs\.com\/tests\/([0-9a-f]{32})/g;

let hasError;
let output;

describe('runs tests on cloud', function () {
  beforeAll(async function () {
    // eslint-disable-next-line jest/no-standalone-expect
    expect(process.env.SAUCE_USERNAME).toBeDefined();
    // eslint-disable-next-line jest/no-standalone-expect
    expect(process.env.SAUCE_ACCESS_KEY).toBeDefined();

    const cucumberRunCommand = 'npx cucumber-js';
    const format = path.join(process.cwd(), 'lib/reporter.js');
    const args = `--config tests/integration/cucumber.json --format ${format}`;

    const p = new Promise((resolve) => {
      exec(`${cucumberRunCommand} ${args}`, async function (err, stdout) {
        hasError = err;
        output = stdout;
        resolve();
      });
    });
    await p;
  });

  test('cucumber execution passed', async function () {
    expect(hasError).toBeNull();
  });

  test('jobs link is displayed', function () {
    const jobUrl = output.match(jobUrlPattern);
    expect(jobUrl.length).toBe(1);
  });

  test('local sauce report exists', async function () {
    expect(existsSync('sauce-test-report.json')).toBe(true);
  });

  test('job has expected assets attached', async function () {
    let jobId = output.match(jobUrlPattern)[0];
    jobId = jobId.slice(jobId.lastIndexOf('/') + 1);

    const url = `https://api.us-west-1.saucelabs.com/rest/v1/jobs/${jobId}/assets`;
    const response = await axios.get(url, {
      auth: {
        username: process.env.SAUCE_USERNAME,
        password: process.env.SAUCE_ACCESS_KEY,
      },
    });
    const assets = response.data;
    expect(assets['console.log']).toBe('console.log');
    expect(assets['sauce-test-report.json']).toBe('sauce-test-report.json');
  });

  test('job has name/tags correctly set', async function () {
    let jobId = output.match(jobUrlPattern)[0];
    jobId = jobId.slice(jobId.lastIndexOf('/') + 1);

    const url = `https://api.us-west-1.saucelabs.com/rest/v1/jobs/${jobId}`;
    const response = await axios.get(url, {
      auth: {
        username: process.env.SAUCE_USERNAME,
        password: process.env.SAUCE_ACCESS_KEY,
      },
    });
    const jobDetails = response.data;

    expect(jobDetails.passed).toBe(true);
    expect(jobDetails.tags.sort()).toEqual(['cucumber', 'demo', 'e2e']);
    expect(jobDetails.name).toBe('my cucumber test');
    expect(jobDetails.build).toBe('mybuild');
  });
});
