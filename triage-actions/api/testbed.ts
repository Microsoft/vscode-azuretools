/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Comment, GitHub, GitHubIssue, Issue, Query, User } from './api'

type TestbedConfig = {
	globalLabels: string[]
	configs: Record<string, any>
	writers: string[]
	releasedCommits: string[]
	queryRunner: (query: Query) => AsyncIterableIterator<(TestbedIssueConstructorArgs | TestbedIssue)[]>
}

export type TestbedConstructorArgs = Partial<TestbedConfig>

export class Testbed implements GitHub {
	public config: TestbedConfig

	constructor(config?: TestbedConstructorArgs) {
		this.config = {
			globalLabels: config?.globalLabels ?? [],
			configs: config?.configs ?? {},
			writers: config?.writers ?? [],
			releasedCommits: config?.releasedCommits ?? [],
			queryRunner:
				config?.queryRunner ??
				async function* () {
					yield []
				},
		}
	}

	async *query(query: Query): AsyncIterableIterator<GitHubIssue[]> {
		for await (const page of this.config.queryRunner(query)) {
			yield page.map((issue) =>
				issue instanceof TestbedIssue ? issue : new TestbedIssue(this.config, issue),
			)
		}
	}

	async hasWriteAccess(user: User): Promise<boolean> {
		return this.config.writers.includes(user.name)
	}

	async repoHasLabel(label: string): Promise<boolean> {
		return this.config.globalLabels.includes(label)
	}
}

type TestbedIssueConfig = {
	issue: Omit<Issue, 'labels'>
	comments: Comment[]
	labels: string[]
	upvotes?: number
}

export type TestbedIssueConstructorArgs = Partial<Omit<TestbedIssueConfig, 'issue'>> & {
	issue?: Partial<Omit<Issue, 'labels'>>
}

export class TestbedIssue extends Testbed implements GitHubIssue {
	public issueConfig: TestbedIssueConfig

	constructor(globalConfig?: TestbedConstructorArgs, issueConfig?: TestbedIssueConstructorArgs) {
		super(globalConfig)
		issueConfig = issueConfig ?? {}
		issueConfig.comments = issueConfig?.comments ?? []
		issueConfig.labels = issueConfig?.labels ?? []
		issueConfig.issue = {
			author: { name: 'JacksonKearl' },
			body: 'issue body',
			locked: false,
			numComments: issueConfig?.comments?.length || 0,
			number: 1,
			open: true,
			title: 'issue title',
			assignee: undefined,
			reactions: {
				'+1': issueConfig.upvotes || 0,
				'-1': 0,
				confused: 0,
				eyes: 0,
				heart: 0,
				hooray: 0,
				laugh: 0,
				rocket: 0,
			},
			closedAt: undefined,
			createdAt: +new Date(),
			updatedAt: +new Date(),
			...issueConfig.issue,
		}

		this.issueConfig = issueConfig as TestbedIssueConfig
	}

	async setMilestone(milestoneId: number): Promise<void> {
		this.issueConfig.issue.milestoneId = milestoneId
	}

	async getIssue(): Promise<Issue> {
		const labels = [...this.issueConfig.labels]
		return { ...this.issueConfig.issue, labels }
	}

	async postComment(body: string, author?: string): Promise<void> {
		this.issueConfig.comments.push({
			author: { name: author ?? 'bot' },
			body,
			id: Math.random(),
			timestamp: +new Date(),
		})
	}

	async deleteComment(id: number): Promise<void> {
		this.issueConfig.comments = this.issueConfig.comments.filter((comment) => comment.id !== id)
	}

	async *getComments(last?: boolean): AsyncIterableIterator<Comment[]> {
		yield last
			? [this.issueConfig.comments[this.issueConfig.comments.length - 1]]
			: this.issueConfig.comments
	}

	async addLabel(label: string): Promise<void> {
		this.issueConfig.labels.push(label)
	}

	async removeLabel(labelToDelete: string): Promise<void> {
		this.issueConfig.labels = this.issueConfig.labels.filter((label) => label !== labelToDelete)
	}

	async closeIssue(): Promise<void> {
		this.issueConfig.issue.open = false
	}

	async lockIssue(): Promise<void> {
		this.issueConfig.issue.locked = true
	}
}
