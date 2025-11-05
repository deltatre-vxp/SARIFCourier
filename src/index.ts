import 'dotenv/config';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import chalk from 'chalk';
import path from 'path';
import fs from 'fs';
import { printBanner } from './banner';
import { loadJsonFile } from './utils';
import { validateSarif } from './validateSarif';
import { convert } from './convert';
import { GitHubPRCommenter } from './githubCommenter';

async function main() {
  printBanner();

  const argv = yargs(hideBin(process.argv))
    .option('sarif', { type: 'string', demandOption: true, describe: 'Path to SARIF report' })
    .option('local', { type: 'boolean', default: false, describe: 'Output markdown summary locally instead of posting to GitHub' })
    .option('output-file-name', { alias: 'ofn', type: 'string', describe: 'Name of output Markdown file. Default: sarif-2-md-output.md' })
    .option('post-target', { type: 'string', describe: 'Where to post the results: "pr" for Pull Request comment, "issue" for Issue comment. If not set, auto-detect.' })
    .help()
    .parseSync();

  try {
    const sarifPath = path.resolve(argv.sarif);
    const sarifData = loadJsonFile(sarifPath);
    validateSarif(sarifData);
    const mdContent = convert(sarifData);
    const githubPRCommenter = new GitHubPRCommenter();

    if (argv.local) {
      const outputMdName = argv["output-file-name"] ? `${argv["output-file-name"]}.md` : 'sarif-2-md-output.md';
      const outputMdPath = path.join(path.dirname(sarifPath), outputMdName);
      fs.writeFileSync(outputMdPath, mdContent, 'utf-8');
      console.log(chalk.green(`✅: Markdown content was written to ${outputMdPath}`));
    } else {
      let postTarget = argv['post-target'];
      if (!postTarget) {
        // Auto-detect PR vs Issue context
        const prNumber =
          githubPRCommenter.pullRequestNumber ||
          (githubPRCommenter.githubRef &&
            githubPRCommenter.githubRef.startsWith('refs/pull/')
            ? githubPRCommenter.githubRef.split('/')[2]
            : undefined);

        postTarget = prNumber ? 'pr' : 'issue';
        console.log('EventName:', postTarget);
      }

      // Identify driver name for unique comment marker
      let driverName = undefined;
      if (sarifData && Array.isArray(sarifData.runs) && sarifData.runs[0]?.tool?.driver?.name) {
        driverName = sarifData.runs[0].tool.driver.name;
      }

      // Validate PR context if required
      let prNumber = undefined;
      if (postTarget === 'pr') {
        prNumber =
          githubPRCommenter.pullRequestNumber ||
          (githubPRCommenter.githubRef &&
            githubPRCommenter.githubRef.startsWith('refs/pull/')
            ? githubPRCommenter.githubRef.split('/')[2]
            : undefined);
        if (!prNumber) {
          throw new Error('GITHUB_PR_NUMBER or a valid GITHUB_REF is required when posting to a PR.');
        }
      }

      console.log('repository:', githubPRCommenter.repository);
      console.log('githubRef:', githubPRCommenter.githubRef);
      console.log('pullRequestNumber:', githubPRCommenter.pullRequestNumber);

      await githubPRCommenter.postComment(mdContent, driverName, postTarget);
      console.log(
        chalk.green(
          `✅: SARIF Report was posted as a ${postTarget === 'pr' ? 'PR' : 'Issue'} comment on GitHub.`
        )
      );
    }
  } catch (e: any) {
    console.error(chalk.red(`❌ Error: ${e.message}`));
    console.error(chalk.yellow('\n--- Stack Trace ---'));
    console.error(e.stack);
    process.exit(1);
  }
}

async function runAction() {
  // Standard GitHub Action inputs are exposed as environment variables: INPUT_<NAME>
  const sarifFile = process.env['INPUT_SARIF_FILE'] || '';
  const postTarget = process.env['INPUT_POST_TARGET'] || '';

  // Additional inputs for GitHub context
  const GITHUB_REPOSITORY = process.env['INPUT_GITHUB_REPOSITORY'];
  const GITHUB_REF = process.env['INPUT_GITHUB_REF'];
  const GITHUB_PR_NUMBER = process.env['INPUT_GITHUB_PR_NUMBER'];

  // Mirror the inputs into expected GitHub environment variables
  if (GITHUB_REPOSITORY) {
    process.env.GITHUB_REPOSITORY = GITHUB_REPOSITORY;
  }
  if (GITHUB_REF) {
    process.env.GITHUB_REF = GITHUB_REF;
  }
  if (GITHUB_PR_NUMBER) {
    process.env.GITHUB_PR_NUMBER = GITHUB_PR_NUMBER;
  }

  // Mandatory SARIF input validation
  if (!sarifFile) {
    console.error('❌ Error: Missing required input: sarif_file');
    process.exit(1);
  }

  // Simulate CLI args for yargs
  process.argv.push('--sarif', sarifFile);
  if (postTarget) {
    process.argv.push('--post-target', postTarget);
  }

  await main();
}

runAction();
