import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import SauceLabs from 'saucelabs';
import { TestRun, Suite, Test, Status as SauceStatus } from '@saucelabs/sauce-json-reporter'
import { SummaryFormatter, formatterHelpers, Status, IFormatterOptions } from '@cucumber/cucumber'
import { Duration, Envelope } from '@cucumber/messages';

type SauceRegion = 'us-west-1' | 'eu-central-1' | 'staging';

type Asset = {
  filename: string;
  data: Buffer;
};

const framework = 'cucumber';

export default class SauceReporter extends SummaryFormatter {
  testRun: TestRun;
  suiteName: string;
  browserName: string;
  build: string;
  tags: string[];
  region: SauceRegion;
  outputFile: string;
  shouldUpload: boolean;
  assets: Asset[];
  api?: SauceLabs;
  cucumberVersion: string;
  startedAt?: string;
  endedAt?: string;
  videoStartTime?: number;
  consoleLog: string[];
  passed: boolean;

  constructor(config: IFormatterOptions) {
    super(config)

    const reporterConfig = config.parsedArgvOptions;
    this.suiteName = reporterConfig?.suiteName || '';
    this.browserName = reporterConfig?.browserName || 'chrome';
    this.build = reporterConfig?.build || '';
    this.tags = reporterConfig?.tags || [];
    this.region = reporterConfig?.region || 'us-west-1';
    this.outputFile = reporterConfig?.outputFile || 'sauce-test-report.json';
    this.shouldUpload = reporterConfig?.upload !== false;
    this.cucumberVersion = 'unknown'
    this.testRun = new TestRun();
    this.assets = [];
    this.consoleLog = [];
    this.passed = true;
    this.startedAt = new Date().toISOString();

    let reporterVersion = 'unknown';
    try {
      const packageData = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf-8'));
      reporterVersion = packageData.version;
    // eslint-disable-next-line no-empty
    } catch (e) {}

    if (process.env.SAUCE_USERNAME && process.env.SAUCE_USERNAME !== '' && process.env.SAUCE_ACCESS_KEY && process.env.SAUCE_ACCESS_KEY !== '') {
      this.api = new SauceLabs({
        user: process.env.SAUCE_USERNAME,
        key: process.env.SAUCE_ACCESS_KEY,
        region: this.region,
        headers: {
          'User-Agent': `cucumber-reporter/${reporterVersion}`
        },
      });
      this.api.tld = this.region === 'staging' ? 'net' : 'com';
    }
    if (process.env.SAUCE_VIDEO_START_TIME) {
      this.videoStartTime = new Date(process.env.SAUCE_VIDEO_START_TIME).getTime();
    }

    config.eventBroadcaster?.on('envelope', async (envelope: Envelope) => {
      if (envelope.testCaseFinished) {
        this.logTestCase(envelope.testCaseFinished)
      }
      if (envelope.testRunFinished) {
        this.endedAt = new Date().toISOString();
        await this.logTestRun(envelope.testRunFinished)
      }
    })
  }

  logTestCase(testCaseFinished: { testCaseStartedId: any }) {
    const testCaseAttempt = this.eventDataCollector.getTestCaseAttempt(testCaseFinished.testCaseStartedId)
    const parsed = formatterHelpers.parseTestCaseAttempt({
      snippetBuilder: this.snippetBuilder, 
      supportCodeLibrary: this.supportCodeLibrary,
      testCaseAttempt 
    })
    const suite = new Suite(parsed.testCase?.sourceLocation?.uri || '')
    const curr = new Suite(parsed.testCase?.name);
    curr.metadata = {
      attempt: parsed.testCase?.attempt,
      sourceLocation: parsed.testCase?.sourceLocation,
    }
    this.consoleLog.push(`${curr.name}\t#${suite.name}`)

    parsed.testSteps.forEach((testStep) => {
      this.consoleLog.push('  ' + testStep.keyword + (testStep.text || '') + ' - ' + Status[testStep.result.status]);
      const test = new Test(`${testStep.keyword}${testStep.text || ''}`)
      const testStatus = testStep.result?.status?.toLowerCase();
      test.status = testStatus === 'skipped' ? SauceStatus.Skipped : (testStatus === 'passed' ? SauceStatus.Passed : SauceStatus.Failed);
      test.output = testStep.result?.message;
      test.duration = this.durationToMilliseconds(testStep.result?.duration);
      test.attachments = [];
      testStep.attachments.forEach((attachment: any) => {
        this.assets.push({
          filename: attachment.testCaseStartedId + '.log',
          data: Buffer.from(attachment.body),
        })
        test.attachments?.push({
          name: attachment.testCaseStartedId + '.log',
          contentType: attachment.mediaType,
          path: ''
        })
      })
      curr.addTest(test);
    })
    curr.status = this.testRun.computeStatus()
    suite.addSuite(curr)
    this.testRun.addSuite(suite);
  }

  async logTestRun(testRunFinished: { success: any; }) {
    this.passed = testRunFinished.success;
    this.reportToFile(this.testRun)

    const id = await this.reportToSauce();
    this.consoleLog.push(testRunFinished.success ? 'SUCCESS' : 'FAILURE')
    this.logSauceJob(id as string)
    this.log('\n')
  }

  durationToMilliseconds(duration: Duration) {
    return (duration.seconds * 1000) + (duration.nanos / 1000000);
  }

  logSauceJob (jobId: string) {
    if (!jobId) {
      const hasCredentials = process.env.SAUCE_USERNAME && process.env.SAUCE_USERNAME !== '' && process.env.SAUCE_ACCESS_KEY && process.env.SAUCE_ACCESS_KEY !== '';
      if (!hasCredentials) {
        this.log(`\nNo results reported to Sauce. $SAUCE_USERNAME and $SAUCE_ACCESS_KEY environment variables must be defined in order for reports to be uploaded to Sauce.`);
      }
      return;
    }
    const jobUrl = this.getJobUrl(jobId as string, this.region)
    this.log(`\nReported jobs to Sauce Labs:\n${jobUrl}`);
  }

  reportToFile(report: TestRun) {
    if (!this.outputFile) {
      return;
    }

    fs.mkdirSync(path.dirname(this.outputFile), { recursive: true });
    report.toFile(this.outputFile);
  }

  async reportToSauce() : Promise<string | undefined> {
    // Currently no reliable way to get the browser version
    const browserVersion = '1.0';

    const jobBody = {
      build: this.build,
      startTime: this.startedAt,
      endTime: this.endedAt,
      passed: this.passed,
      name: this.suiteName,
      tags: this.tags,
      browserName: this.browserName,
      browserVersion,
      framework,
      frameworkVersion: this.cucumberVersion, 
      platformName: this.getPlatformName(),
    };

    if (this.shouldUpload) {
      const sessionID = await this.createJob(jobBody);
      if (sessionID) {
        await this.uploadAssets(sessionID);
      }
      return sessionID;
    }
  }

  async uploadAssets (sessionId: string) {
    this.assets.push({
      filename: 'console.log',
      data: Buffer.from(this.consoleLog.join('\n').toString()),
    });

    this.assets.push({
      filename: 'sauce-test-report.json',
      data: Buffer.from(this.testRun.stringify()),
    });

    await Promise.all([
      // Casting this.assets as string[] to fit the definition for files. Will refine this later.
      this.api?.uploadJobAssets(sessionId, { files: this.assets as unknown as string[] }).then(
        (resp : any) => {
          if (resp.errors) {
            for (const err of resp.errors) {
              console.error(err);
            }
          }
        },
        (e) => console.log('Upload failed:', e.stack)
      )
    ]);
  }

  async createJob (body : any) {
    try {
      const resp : any = await this.api?.createJob(body);

      return resp?.ID;
    } catch (e) {
      console.error('Create job failed: ', e);
    }
  }

  getPlatformName () {
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

  getJobUrl (sessionId: string, region: SauceRegion) {
    const tld = region === 'staging' ? 'net' : 'com';

    if (region === 'us-west-1') {
      return `https://app.saucelabs.com/tests/${sessionId}`
    }
    return `https://app.${region}.saucelabs.${tld}/tests/${sessionId}`;
  }
}

module.exports = SauceReporter