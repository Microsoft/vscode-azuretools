/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface GitHub {
	query(query: Query): AsyncIterableIterator<GitHubIssue[]>
	hasWriteAccess(user: User): Promise<boolean>
	repoHasLabel(label: string): Promise<boolean>
}

export interface GitHubIssue extends GitHub {
	getIssue(): Promise<Issue>

	postComment(body: string): Promise<void>
	deleteComment(id: number): Promise<void>
	getComments(last?: boolean): AsyncIterableIterator<Comment[]>

	closeIssue(): Promise<void>
	lockIssue(): Promise<void>

	setMilestone(milestoneId: number): Promise<void>

	addLabel(label: string): Promise<void>
	removeLabel(label: string): Promise<void>
}

type SortVar =
	| 'comments'
	| 'reactions'
	| 'reactions-+1'
	| 'reactions--1'
	| 'reactions-smile'
	| 'reactions-thinking_face'
	| 'reactions-heart'
	| 'reactions-tada'
	| 'interactions'
	| 'created'
	| 'updated'
type SortOrder = 'asc' | 'desc'
export type Reactions = {
	'+1': number
	'-1': number
	laugh: number
	hooray: number
	confused: number
	heart: number
	rocket: number
	eyes: number
}

export interface User {
	name: string
	isGitHubApp?: boolean
}
export interface Comment {
	author: User
	body: string
	id: number
	timestamp: number
}
export interface Issue {
	author: User
	body: string
	title: string
	labels: string[]
	open: boolean
	locked: boolean
	number: number
	numComments: number
	reactions: Reactions
	milestoneId: number | null
	assignee?: string
	createdAt: number
	updatedAt: number
	closedAt?: number
}
export interface Query {
	q: string
	sort?: SortVar
	order?: SortOrder
}
