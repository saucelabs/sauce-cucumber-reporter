import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import SauceLabs from 'saucelabs';
import { TestRun, Suite, Test } from '@saucelabs/sauce-json-reporter'

const { SummaryFormatter, formatterHelpers, Status } = require('@cucumber/cucumber')

type SauceRegion = 'us-west-1' | 'eu-central-1' | 'staging';

type ReporterConfig = {
  browserName?: string;
  build?: string;
  tags?: string[];
  region?: SauceRegion;
  tld?: string;
  outputFile?: string;
  upload?: boolean;
  suiteName?: string;
};

type ReportsRequestBody = {
  name?: string;
  browserName?: string;
  browserVersion?: string;
  platformName?: string;
  framework?: string;
  frameworkVersion?: string;
  passed?: boolean;
  startTime: string;
  endTime: string;
  build?: string;
  tags?: string[];
  suite?: string;
};

type Asset = {
  filename: string;
  data: Buffer;
};

class SauceReporter extends SummaryFormatter {
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
  startedAt?: Date;
  endedAt?: Date;
  videoStartTime?: number;
  consoleLog: string[];
  passed: boolean;

  constructor(config: any) {
    super(config)

    const reporterConfig: ReporterConfig = config.parsedArgvOptions;
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

    config.eventBroadcaster?.on('envelope', (envelope: {
      testRunFinished: any; testCaseFinished: any 
    }) => {
      if (envelope.testCaseFinished) {
        this.logTestCase(envelope.testCaseFinished)
      }
      if (envelope.testRunFinished) {
        this.logTestRun(envelope.testRunFinished)
      }
    })
  }

  logTestCase(testCaseFinished: { testCaseStartedId: any }) {
    const testCaseAttempt = this.eventDataCollector.getTestCaseAttempt(testCaseFinished.testCaseStartedId)
    const parsed = formatterHelpers.parseTestCaseAttempt({
      cwd: this.cwd,
      snippetBuilder: this.snippetBuilder, 
      supportCodeLibrary: this.supportCodeLibrary,
      testCaseAttempt 
    })
    const suite = new Suite(parsed.testCase?.sourceLocation?.uri)
    const curr = new Suite(parsed.testCase?.name);
    const suiteStatus = parsed.testCase?.worstTestStepResult?.status?.toLowerCase();
    curr.status = suiteStatus;
    curr.metadata = {
      attempt: parsed.testCase?.attempt,
      sourceLocation: parsed.testCase?.sourceLocation,
    }
    this.consoleLog.push(`${curr.name}\t#${suite.name}`)

    parsed.testSteps.forEach((testStep: {
      attachments: Asset[];
      keyword: string; text: any; result: {
        duration: any;
        message: string | undefined;
        status: string 
      } 
    }) => {
      this.consoleLog.push('  ' + testStep.keyword + (testStep.text || '') + ' - ' + Status[testStep.result.status]);
      const test = new Test(`${testStep.keyword}${testStep.text || ''}`)
      const testStatus = testStep.result?.status?.toLowerCase() as typeof Status;
      test.status = testStatus;
      test.output = testStep.result?.message;
      test.duration = this.getDuration(testStep.result?.duration);
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
    suite.addSuite(curr)
    this.testRun.addSuite(suite);
  }

  async logTestRun(testRunFinished: { success: any; }) {
    this.passed = testRunFinished.success;
    this.reportToFile(this.testRun)

    const id = await this.reportToSauce(this.testRun);
    this.consoleLog.push(testRunFinished.success ? 'SUCCESS' : 'FAILURE')
    this.logSauceJob(id as string)
    this.log('\n')
  }

  getDuration(duration: any) {
    return (duration.seconds * 1000) + (duration.nanos / 1000000000);
  }

  logSauceJob (jobId: string) {
    if (jobId.length < 1) {
      let msg = '';
      const hasCredentials = process.env.SAUCE_USERNAME && process.env.SAUCE_USERNAME !== '' && process.env.SAUCE_ACCESS_KEY && process.env.SAUCE_ACCESS_KEY !== '';
      if (!hasCredentials) {
        msg = `\nNo results reported to Sauce. $SAUCE_USERNAME and $SAUCE_ACCESS_KEY environment variables must be defined in order for reports to be uploaded to Sauce.`;
      }
      this.log(msg);
      this.log();
      return;
    }
    const jobUrl = this.getJobUrl(jobId as string, this.region)
    this.log(`\nReported jobs to Sauce Labs:\n`);
    this.log(jobUrl)
  }

  reportToFile(report: TestRun) {
    if (!this.outputFile) {
      return;
    }

    fs.mkdirSync(path.dirname(this.outputFile), { recursive: true });
    report.toFile(this.outputFile);
  }

  async reportToSauce(report: TestRun) : Promise<string | undefined> {
    // Currently no reliable way to get the browser version
    const browserVersion = '1.0';

    const jobBody = this.createBody({
      build: this.build,
      startedAt: this.startedAt ? this.startedAt.toISOString() : new Date().toISOString(),
      endedAt: this.endedAt ? this.endedAt.toISOString() : new Date().toISOString(),
      success: this.passed,
      suiteName: this.suiteName,
      tags: this.tags,
      browserName: this.browserName,
      browserVersion,
      cucumberVersion: this.cucumberVersion, 
    });

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
      filename: this.outputFile,
      data: Buffer.from(this.testRun.stringify()),
    });

    await Promise.all([
      this.api?.uploadJobAssets(sessionId, { files: this.assets as unknown as string[] }).then(
        (resp : any) => {
          if (resp.errors) {
            for (let err of resp.errors) {
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

  createBody (args: {
    suiteName: string,
    startedAt: string,
    endedAt: string,
    success: boolean,
    tags: string[],
    build: string,
    browserName: string,
    browserVersion: string,
    cucumberVersion: string,
  }) : ReportsRequestBody {

    return {
      name: args.suiteName,
      startTime: args.startedAt,
      endTime: args.endedAt,
      framework: 'playwright',
      frameworkVersion: args.cucumberVersion,
      suite: args.suiteName,
      passed: args.success,
      tags: args.tags,
      build: args.build,
      browserName: args.browserName,
      browserVersion: args.browserVersion,
      platformName: this.getPlatformName(),
    };
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