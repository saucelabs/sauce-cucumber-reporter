# sauce-cucumber-reporter
This Cucumber plugins reports each project to your Sauce Labs account.

## Installation

Install from npm:
```
npm install @saucelabs/cucumber-reporter
```

### Sauce Labs credentials

`SAUCE_USERNAME` and `SAUCE_ACCESS_KEY` environment variables needs to be set to
allow the plugin to report your results to Sauce Labs.
Your Sauce Labs Username and Access Key are available from your
[dashboard](https://app.saucelabs.com/user-settings).


## Usage

Add to Cucumber formatter
```
npx cucumber-js --format=@saucelabs/cucumber-reporter
```

You can also configure using `cucumber.json`. To achieve that, add `'@saucelabs/cucumber-reporter'` to the reporter section of your configuration:
```
{
  "default": {
    "requireModule": [
      "ts-node/register"
    ],
    "format": "@saucelabs/cucumber-reporter"
  }
}
```

### Plugin configuration

`@saucelabs/cucumber-reporter` is configurable through your cucumber config file.

Example `cucumber.json`
```
{
  "default": {
    "requireModule": [
      "ts-node/register"
    ],
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

| Name | Description | Kind |
| --- | --- | --- |
| browserName | Sets browserName | String |
| build | Sets a build ID. (Default: `''`) | String |
| tags | Tags to add to the uploaded Sauce job. (Default: `[]`) | String[] |
| region | Sets the region. (Default: `us-west-1`) | `us-west-1` \| `eu-central-1` |
| upload | Whether to upload report and assets to Sauce (Default: `true`) | boolean |
| outputFile | The local path to write the sauce test report (Default: `sauce-test-report.json`). | String |
| suiteName | Sets the suite name (Default: `Unnamed job ${job_id}`). | String |
