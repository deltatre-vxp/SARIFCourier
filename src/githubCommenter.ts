import axios from 'axios';
import { eventNames } from 'process';

export class GitHubPRCommenter {
  private token: string;
  private host: string;
  private repo: string;
  private ref: string;
  private headers: Record<string, string>;
  private prNumber: string | undefined;
  private branchName: string | undefined;
  private scanTitle: string;

  constructor() {
    // Core GitHub configuration
    this.token = process.env.GITHUB_TOKEN || '';
    this.host = process.env.GITHUB_HOST || 'https://api.github.com';

    // Prefer Action inputs if defined, else fallback to normal GitHub-provided env vars
    const inputRepository = process.env['INPUT_GITHUB_REPOSITORY'];
    const inputRef = process.env['INPUT_GITHUB_REF'];
    const inputPrNumber = process.env['INPUT_GITHUB_PR_NUMBER'];
    const inputBranch = process.env['INPUT_GITHUB_BRANCH']

    console.log("🔍 Environment variable sources:");
    console.log("INPUT_GITHUB_REPOSITORY:", inputRepository);
    console.log("INPUT_GITHUB_REF:", inputRef);
    console.log("INPUT_GITHUB_PR_NUMBER:", inputPrNumber);
    console.log("INPUT_GITHUB_BRANCH:", inputBranch);

    // Resolution order: Inputs > Standard env vars
    this.repo = inputRepository || '';
    this.ref = inputRef || '';
    this.prNumber = inputPrNumber || '';
    this.branchName = inputBranch || '';
    if (this.branchName !== '') {
      this.scanTitle = `🚨 Security Results for Branch: ${this.branchName}`;
    } else {
      this.scanTitle = `🚨 Security Results for PR: ${this.prNumber}`;
    }

    console.log("GITHUB_REPOSITORY:", this.repo);
    console.log("GITHUB_REF:", this.ref);
    console.log("GITHUB_PR_NUMBER:", this.prNumber);

    if (!this.token) {
      throw new Error('❌ GITHUB_TOKEN environment variable is required.');
    }
    if (!this.repo) {
      throw new Error('❌ GITHUB_REPOSITORY or INPUT_GITHUB_REPOSITORY must be provided.');
    }

    this.headers = {
      Authorization: `token ${this.token}`,
      Accept: 'application/vnd.github.v3+json',
    };
  }

  // ======= GETTERS =======

  /** GitHub API authentication token */
  public get githubToken(): string {
    return this.token;
  }

  /** Base GitHub API host */
  public get githubHost(): string {
    return this.host;
  }

  /** Repository in owner/repo format */
  public get repository(): string {
    return this.repo;
  }

  /** Current Git reference (branch or PR ref) */
  public get githubRef(): string {
    return this.ref;
  }

  /** Pull request number (if available) */
  public get pullRequestNumber(): string | undefined {
    return this.prNumber;
  }

  /** Title used for SARIF or scan result comments */
  public get securityScanTitle(): string {
    return this.scanTitle;
  }
  // ======= SETTERSs =======
  public set securityScanTitle(scanTitle: string) {
    this.scanTitle = this.scanTitle
  }

  private async _postComment(driverName:string,issueNumber:string,body:string){
    const commentsUrl = `${this.host}/repos/${this.repo}/issues/${issueNumber}/comments`;
    const marker = `<!-- SARIFCourier:${driverName || ""} -->`;
    const commentBody = `${marker}\n${body}`;
    const createResp = await axios.post(commentsUrl, { commentBody }, { headers: this.headers });
    if (createResp.status !== 201) {
      throw new Error(`Failed to post comment: ${createResp.status} ${createResp.statusText}`);
    }
    console.log(`Posting new comment: ${commentsUrl}`)
    return createResp.data;
  }

  private async _updateComment(issueNumber:string, body:string){
    const updateUrl = `${this.host}/repos/${this.repo}/issues/comments/${issueNumber}`;
    const updateResp = await axios.patch(updateUrl, { body: body }, { headers: this.headers });
    if (updateResp.status !== 200) {
      throw new Error(`Failed to update comment: ${updateResp.status} ${updateResp.statusText}`);
    }
    console.log(`Updating existing comment: ${updateUrl}`)
    return updateResp.data;
  }

  private async _updateIssue(issueNumber:string,state:string,body:string){
    const updateResp = await axios.patch(`${this.host}/repos/${this.repo}/issues/${issueNumber}`,
      { state: state, body: body},
      { headers: this.headers }
    );
    console.log("Update status:", updateResp.status)
    if (updateResp.status !== 200) {
      throw new Error(`Failed to create issue: ${updateResp.status} ${updateResp.statusText}`);
    }
  }

  async handleComment(body: string, driverName?: string, postTarget?: string): Promise<any> {
    if (driverName === undefined){
      throw Error("DriveName undefined!")
    }
    // Decide whether to post to PR or issue
    let issueNumber: string | undefined = undefined;
    if (postTarget === 'pr') {
      // Extract PR number only when needed
      let prNumber = this.prNumber || (this.ref.startsWith('refs/pull/') ? this.ref.split('/')[2] : undefined);
      if (!prNumber) {
        throw new Error('GITHUB_PR_NUMBER or a valid GITHUB_REF is required when posting to a PR.');
      }
      issueNumber = prNumber;
    } else if (postTarget === 'issue') {
      // Try to find an open issue with a SARIF-Courier label or title, else create one
      const issuesUrl = `${this.host}/repos/${this.repo}/issues?state=all&labels=sarif-courier`;
      let issueId: string | undefined = undefined;
      let issueState: string | undefined = undefined;
      console.log(issuesUrl)
      try {
        const issuesResp = await axios.get(issuesUrl, { headers: this.headers });
        //console.log(issuesResp)
        if (issuesResp.status === 200 && Array.isArray(issuesResp.data)) {
          // Match the actual title used for the issue
          const found = issuesResp.data.find((i: any) => i.title && i.title === this.scanTitle && i.state === "open");
          if (found) {
            issueId = found.number;
            issueState = found.state;
          }
        }
      } catch (error) {
        //throw error;
        console.log(error)
      }
      if (!issueId) {
        // Create a new issue and return immediately (do not post a comment)
        const createResp = await axios.post(`${this.host}/repos/${this.repo}/issues`, {
          title: this.scanTitle,
          body,
          labels: ['sarif-courier']
        }, { headers: this.headers });
        if (createResp.status !== 201) {
          throw new Error(`Failed to create issue: ${createResp.status} ${createResp.statusText}`);
        }
        return createResp.data; // Do not post a comment if issue was just created
      } else {
        // if the issue is closed -> reopen
        const marker = `<!-- SARIFCourier:${driverName || ""} -->`;
        const commentBody = `${marker}\n${body}`;
        await this._updateIssue(issueId,"open",commentBody)
      }
    } else {
      // Default: PR
      let prNumber = this.prNumber || (this.ref.startsWith('refs/pull/') ? this.ref.split('/')[2] : undefined);
      if (!prNumber) {
        throw new Error('GITHUB_PR_NUMBER or a valid GITHUB_REF is required when posting to a PR.');
      }
      issueNumber = prNumber;
    }
    if(postTarget === "pr" && issueNumber){
      const commentsUrl = `${this.host}/repos/${this.repo}/issues/${issueNumber}/comments`;
      console.log(commentsUrl)
      const commentsResp = await axios.get(commentsUrl, { headers: this.headers });
      console.log("Comments: ",commentsResp.data)
      if (commentsResp.status === 200 && Array.isArray(commentsResp.data)) {
        const marker = `<!-- SARIFCourier:${driverName || ""} -->`;
        console.log(marker)
        //get marker in first 50 chars
        const existing = commentsResp.data.find((c: any) => typeof c.body === 'string' && c.body.substring(0,50).includes(marker));
        const commentBody = `${marker}\n${body}`;
        if (existing) {
          console.log("Existing ok: ", existing)
          // Update existing comment
          return await this._updateComment(existing.id,commentBody)
        } else {
          // Post new comment
          return await this._postComment(driverName,issueNumber,body)
        }
      }
    }
    // Fallback: just post a new comment
    //return await this._postComment(driverName,issueNumber,body)
  }
}
