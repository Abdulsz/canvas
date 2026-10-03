import { NodeSqliteWrapper, SQLiteSyncStorage, TLSocketRoom } from '@tldraw/sync-core'
import { createTLSchema } from '@tldraw/tlschema'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { Author } from '../../shared/protocol.ts'
import { summarizeShape, type ShapeRecord, type ShapeSummary } from './shapes.ts'

const schema = createTLSchema()

export type ChangeEntry = {
	op: 'created' | 'updated' | 'deleted'
	at: number
	author: Author | null
	shape: ShapeSummary
}

export type RoomListener = (changes: ChangeEntry[]) => void

/**
 * One shared board: the authoritative tldraw document (TLSocketRoom backed by
 * SQLite), a mirror of its shape records (for authorship checks), and a log of
 * student edits that the agent reads with get_recent_changes.
 */
export class Room {
	readonly socketRoom: TLSocketRoom<any, void>
	readonly shapes = new Map<string, ShapeRecord>()
	readonly changeLog: ChangeEntry[] = []
	private listeners = new Set<RoomListener>()

	constructor(
		readonly id: string,
		dataDir: string | null
	) {
		let storage: SQLiteSyncStorage<any> | undefined
		if (dataDir) {
			const db = new DatabaseSync(join(dataDir, `${id}.db`))
			storage = new SQLiteSyncStorage({ sql: new NodeSqliteWrapper(db as any) })
		}
		this.socketRoom = new TLSocketRoom({
			schema,
			storage,
			onCommittedChanges: ({ diff }) => this.applyDiff(diff),
		})
		for (const doc of this.socketRoom.getCurrentSnapshot().documents) {
			if (doc.state.typeName === 'shape') this.shapes.set(doc.state.id, doc.state as unknown as ShapeRecord)
		}
	}

	onChanges(listener: RoomListener) {
		this.listeners.add(listener)
		return () => this.listeners.delete(listener)
	}

	getShape(id: string) {
		return this.shapes.get(id.startsWith('shape:') ? id : `shape:${id}`)
	}

	getAuthor(id: string): Author | null {
		return (this.getShape(id)?.meta?.author as Author | undefined) ?? null
	}

	/** Change log entries made by students after `since` (ms epoch). */
	changesSince(since: number) {
		return this.changeLog.filter((c) => c.at > since && c.author?.kind !== 'agent')
	}

	private applyDiff(diff: { puts: Record<string, any>; deletes: string[] }) {
		const now = Date.now()
		const entries: ChangeEntry[] = []
		for (const value of Object.values(diff.puts)) {
			const [before, after] = Array.isArray(value) ? value : [undefined, value]
			if (after?.typeName !== 'shape') continue
			this.shapes.set(after.id, after)
			const author = (after.meta?.updatedBy ?? after.meta?.author ?? null) as Author | null
			entries.push({ op: before ? 'updated' : 'created', at: now, author, shape: summarizeShape(after) })
		}
		for (const id of diff.deletes) {
			const before = this.shapes.get(id)
			if (!before) continue
			this.shapes.delete(id)
			// Deletes carry no author; credit the last editor of the shape.
			const author = (before.meta?.updatedBy ?? before.meta?.author ?? null) as Author | null
			entries.push({ op: 'deleted', at: now, author, shape: summarizeShape(before) })
		}
		if (!entries.length) return
		this.changeLog.push(...entries)
		if (this.changeLog.length > 2000) this.changeLog.splice(0, this.changeLog.length - 2000)
		for (const l of this.listeners) l(entries)
	}
}

const ROOM_ID = /^[a-zA-Z0-9_-]{1,64}$/

export class RoomManager {
	private rooms = new Map<string, Room>()

	constructor(private dataDir: string | null) {
		if (dataDir) mkdirSync(dataDir, { recursive: true })
	}

	static isValidId(id: string) {
		return ROOM_ID.test(id)
	}

	get(id: string): Room {
		if (!RoomManager.isValidId(id)) throw new Error(`invalid room id: ${id}`)
		let room = this.rooms.get(id)
		if (!room) {
			room = new Room(id, this.dataDir)
			this.rooms.set(id, room)
		}
		return room
	}
}
