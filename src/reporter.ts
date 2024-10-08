import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  TestRun,
  Suite,
  Test,
  Status as SauceStatus,
} from '@saucelabs/sauce-json-reporter';
import {
  SummaryFormatter,
  formatterHelpers,
  IFormatterOptions,
} from '@cucumber/cucumber';
import { Duration, Envelope } from '@cucumber/messages';
import { Asset, TestComposer } from '@saucelabs/testcomposer';
import stream from 'stream';

type SauceRegion = 'us-west-1' | 'eu-central-1' | 'staging';

const isAccountSet = () => {
  return process.env.SAUCE_USERNAME && process.env.SAUCE_ACCESS_KEY;
};

export default class SauceReporter extends SummaryFormatter {
  testRun: TestRun;
  name: string;
  /**
   * @deprecated Use `name` instead.
   */
  suiteName: string;
  browserName: string;
  build: string;
  tags: string[];
  region: SauceRegion;
  outputFile: string;
  shouldUpload: boolean;
  assets: Asset[];
  testComposer?: TestComposer;
  cucumberVersion: string;
  startedAt?: string;
  endedAt?: string;
  videoStartTime?: number;
  consoleLog: string[];
  passed: boolean;
  baseLog: (buffer: string | Uint8Array) => void;

  logWrapper(buffer: string | Uint8Array) {
    this.baseLog(buffer);
    this.consoleLog.push(Buffer.from(buffer).toString('utf8'));
  }

  constructor(config: IFormatterOptions) {
    super(config);

    const reporterConfig = config.parsedArgvOptions;

    this.baseLog = this.log;
    this.log = this.logWrapper;
    this.suiteName = reporterConfig?.suiteName || '';
    this.name = reporterConfig?.name || '';
    if (this.suiteName && !this.name) {
      this.name = this.suiteName;
    }
    this.browserName = reporterConfig?.browserName || 'chrome';
    this.build = reporterConfig?.build || '';
    this.tags = reporterConfig?.tags || [];
    this.region = reporterConfig?.region || 'us-west-1';
    this.outputFile = reporterConfig?.outputFile || 'sauce-test-report.json';
    this.cucumberVersion = 'unknown';
    this.testRun = new TestRun();
    this.assets = [];
    this.consoleLog = [];
    this.passed = true;
    this.startedAt = new Date().toISOString();
    this.shouldUpload = reporterConfig?.upload !== false;

    // Skip uploads on sauce VM or when credentials aren't set.
    if (process.env.SAUCE_VM || !isAccountSet()) {
      this.shouldUpload = false;
    }
    if (isAccountSet()) {
      this.setupTestComposer();
    }

    if (process.env.SAUCE_VIDEO_START_TIME) {
      this.videoStartTime = new Date(
        process.env.SAUCE_VIDEO_START_TIME,
      ).getTime();
    }

    config.eventBroadcaster?.on('envelope', async (envelope: Envelope) => {
      if (envelope.testCaseFinished) {
        this.logTestCase(envelope.testCaseFinished);
      }
      if (envelope.testRunFinished) {
        this.endedAt = new Date().toISOString();
        await this.logTestRun(envelope.testRunFinished);
      }
    });
  }

  setupTestComposer() {
    let reporterVersion = 'unknown';
    try {
      const packageData = JSON.parse(
        fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf-8'),
      );
      reporterVersion = packageData.version;
    } catch (e) {
      /* empty */
    }

    this.testComposer = new TestComposer({
      region: this.region,
      username: process.env.SAUCE_USERNAME || '',
      accessKey: process.env.SAUCE_ACCESS_KEY || '',
      headers: { 'User-Agent': `cucumber-reporter/${reporterVersion}` },
    });
  }

  logTestCase(testCaseFinished: { testCaseStartedId: string }) {
    const endTime = new Date();
    const testCaseAttempt = this.eventDataCollector.getTestCaseAttempt(
      testCaseFinished.testCaseStartedId,
    );
    let parsed: any;
    try {
      parsed = formatterHelpers.parseTestCaseAttempt({
        snippetBuilder: this.snippetBuilder,
        supportCodeLibrary: this.supportCodeLibrary,
        testCaseAttempt,
      });
    } catch (e) {
      console.error('failed to parse test data: ', e);
      if (e instanceof TypeError) {
        console.warn(
          '\n\n`paths` field might be set multiple times in your configuration file. Please check your Cucumber.js config file.\n',
        );
      }
      return;
    }
    const suite = new Suite(parsed.testCase?.sourceLocation?.uri || '');
    const curr = new Suite(parsed.testCase?.name);
    curr.metadata = {
      attempt: parsed.testCase?.attempt,
      sourceLocation: parsed.testCase?.sourceLocation,
    };

    parsed.testSteps.forEach((testStep: any) => {
      const test = new Test(`${testStep.keyword}${testStep.text || ''}`);
      const testStatus = testStep.result?.status?.toLowerCase();
      test.status =
        testStatus === 'skipped'
          ? SauceStatus.Skipped
          : testStatus === 'passed'
            ? SauceStatus.Passed
            : SauceStatus.Failed;
      test.output = testStep.result?.message;
      test.duration = this.durationToMilliseconds(testStep.result?.duration);
      test.attachments = [];
      testStep.attachments.forEach((attachment: any) => {
        const r = new stream.Readable();
        r.push(attachment.body);
        r.push(null);

        this.assets.push({
          filename: attachment.testCaseStartedId + '.log',
          data: r,
        });
        test.attachments?.push({
          name: attachment.testCaseStartedId + '.log',
          contentType: attachment.mediaType,
          path: '',
        });
      });
      curr.addTest(test);
    });
    this.calculateTestTiming(curr, endTime);
    suite.addSuite(curr);
    this.testRun.addSuite(suite);
  }

  // Calculate each test's startTime and videoTimestamp.
  calculateTestTiming(suite: Suite, endTime: Date) {
    let currEndTime = endTime;
    for (let i = suite.tests.length - 1; i >= 0; i--) {
      const test = suite.tests[i];
      const startTime = new Date(currEndTime.getTime() - test.duration);

      suite.tests[i].startTime = startTime;
      if (this.videoStartTime) {
        suite.tests[i].videoTimestamp =
          (startTime.getTime() - this.videoStartTime) / 1000;
      }
      currEndTime = test.startTime;
    }
  }

  async logTestRun(testRunFinished: { success: boolean }) {
    this.testRun.status = this.testRun.computeStatus();
    this.passed = testRunFinished.success;
    this.reportToFile(this.testRun);

    if (!this.shouldUpload) {
      if (!process.env.SAUCE_VM && !isAccountSet()) {
        console.warn(
          'Credentials not set! SAUCE_USERNAME and SAUCE_ACCESS_KEY environment ' +
            'variables must be defined in order for reports to be uploaded to Sauce Labs.',
        );
      }
      return;
    }

    try {
      const job = await this.reportToSauce();
      this.log(`\nReport created: ${job?.url}\n`);
    } catch (e) {
      if (e instanceof Error) {
        this.log(`\nFailed to report to Sauce Labs: ${e.message}\n`);
      }
    }
  }

  durationToMilliseconds(duration: Duration) {
    return Math.round(duration.seconds * 1000 + duration.nanos / 1000000);
  }

  reportToFile(report: TestRun) {
    if (!this.outputFile) {
      return;
    }

    fs.mkdirSync(path.dirname(this.outputFile), { recursive: true });
    report.toFile(this.outputFile);
  }

  async reportToSauce() {
    const job = await this.testComposer?.createReport({
      name: this.name,
      startTime: this.startedAt || '',
      endTime: this.endedAt || '',
      framework: 'cucumber',
      frameworkVersion: this.cucumberVersion,
      passed: this.passed,
      tags: this.tags,
      build: this.build,
      browserName: this.browserName,
      browserVersion: '1.0', // Currently there's no reliable way to get the browser version.
      platformName: this.getPlatformName(),
    });

    if (!job || !job.id) {
      return;
    }
    await this.uploadAssets(job.id);
    return job;
  }

  async uploadAssets(jobId: string) {
    const logReadable = new stream.Readable();
    logReadable.push(this.consoleLog.join('\n').toString());
    logReadable.push(null);

    const reportReadable = new stream.Readable();
    reportReadable.push(this.testRun.stringify());
    reportReadable.push(null);

    this.assets.push(
      {
        filename: 'console.log',
        data: logReadable,
      },
      {
        filename: 'sauce-test-report.json',
        data: reportReadable,
      },
    );

    await this.testComposer?.uploadAssets(jobId, this.assets).then(
      (resp) => {
        if (resp.errors) {
          for (const err of resp.errors) {
            this.log(`Failed to upload asset: ${err}\n`);
          }
        }
      },
      (e: Error) => this.log(`Failed to upload assets: ${e.message}\n`),
    );
  }

  getPlatformName() {
    switch (os.platform()) {
      case 'darwin':
        return `Mac ${os.release()}`;
      case 'win32':
        return `windows ${os.release()}`;
      case 'linux':
        return 'linux';
      default:
        return 'unknown';
    }
  }
}
