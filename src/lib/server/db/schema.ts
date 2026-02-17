import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/**
 * Todo table schema
 * Stores all todo items with their properties
 */
export const todo = sqliteTable('todo', {
	// Unique identifier for each todo item
	id: text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),

	// Required: The main title of the todo item
	title: text('title').notNull(),

	// Optional: A longer description of the todo item
	description: text('description'),

	// Optional: Any additional notes about the todo
	notes: text('notes'),

	// Boolean flag: whether a contractor is hired for this task (0 = false, 1 = true)
	contractorHired: integer('contractor_hired').notNull().default(0),

	// Optional: Name of the contractor (shown only if contractorHired is true)
	contractorName: text('contractor_name'),

	// Optional: Additional details about the contractor
	contractorDetails: text('contractor_details'),

	// Optional: Cost for the task (stored as cents)
	cost: integer('cost'),

	// Whether the todo has been completed (0 = false, 1 = true)
	completed: integer('completed').notNull().default(0),

	// Order position for drag-and-drop reordering (lower = higher in list)
	sortOrder: integer('sort_order').notNull().default(0),

	// Timestamp when the todo was created
	createdAt: integer('created_at')
		.notNull()
		.$defaultFn(() => Date.now()),

	// Timestamp when the todo was last updated
	updatedAt: integer('updated_at')
		.notNull()
		.$defaultFn(() => Date.now())
});
