# sauce-cucumber-reporter

This Cucumber plugin reports each project to your Sauce Labs account.

## Installation

Install from npm:

```sh
npm install @saucelabs/cucumber-reporter
```

### Sauce Labs Credentials

Set the `SAUCE_USERNAME` and `SAUCE_ACCESS_KEY` environment variables to enable the plugin to report your results to Sauce Labs. Your Sauce Labs Username and Access Key can be found in your [dashboard](https://app.saucelabs.com/user-settings).

## Usage

Add to your Cucumber formatter:

```sh
npx cucumber-js --format=@saucelabs/cucumber-reporter
```

Alternatively, configure it using `cucumber.json` by adding `'@saucelabs/cucumber-reporter'` to the reporter section of your configuration:

```json
{
  "default": {
    "requireModule": ["ts-node/register"],
    "format": "@saucelabs/cucumber-reporter"
  }
}
```

### Plugin Configuration

Configure the `@saucelabs/cucumber-reporter` through your Cucumber config file.

Example `cucumber.json`:

```json
{
  "default": {
    "requireModule": ["ts-node/register"],
    "format": "@saucelabs/cucumber-reporter",
    "formatOptions": {
      "suiteName": "my cucumber test",
      "build": "mybuild",
      "tags": ["demo", "e2e", "cucumber"],
      "region": "eu-central-1"
    }
  }
}
```

Configuration Parameters:

| Name          | Description                                                                       | Type       |
| ------------- | --------------------------------------------------------------------------------- | ---------- |
| `browserName` | Sets the browser name.                                                            | `String`   |
| `build`       | Sets a build ID. Default: `''`.                                                   | `String`   |
| `tags`        | Tags to add to the uploaded Sauce job. Default: `[]`.                             | `String[]` |
| `region`      | Sets the region. Default: `us-west-1`.                                            | `String`   |
| `upload`      | Whether to upload report and assets to Sauce. Default: `true`.                    | `boolean`  |
| `outputFile`  | The local path to write the sauce test report. Default: `sauce-test-report.json`. | `String`   |
| `suiteName`   | Sets the suite name. Default: `Unnamed job ${job_id}`.                            | `String`   |
