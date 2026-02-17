import { db } from '$lib/server/db';
import { todo } from '$lib/server/db/schema';
import { eq, asc } from 'drizzle-orm';
import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

/**
 * Load function - fetches all todos from the database
 * Todos are sorted by their sortOrder (ascending)
 */
export const load: PageServerLoad = async () => {
	// Fetch all todos, ordered by sortOrder for proper drag-drop positioning
	const todos = await db.select().from(todo).orderBy(asc(todo.sortOrder));
	return { todos };
};

/**
 * Form actions for CRUD operations on todos
 * SvelteKit form actions provide progressive enhancement - forms work without JS
 */
export const actions: Actions = {
	/**
	 * Create a new todo item
	 * Required: title
	 * Optional: description, notes, contractor fields, cost fields
	 */
	create: async ({ request }) => {
		const formData = await request.formData();
		const title = formData.get('title')?.toString().trim();

		// Validate required field
		if (!title) {
			return fail(400, { error: 'Title is required' });
		}

		// Get the current highest sortOrder to place new item at the bottom
		const lastTodo = await db
			.select({ sortOrder: todo.sortOrder })
			.from(todo)
			.orderBy(asc(todo.sortOrder))
			.limit(1);
		const nextSortOrder = lastTodo.length > 0 ? lastTodo[0].sortOrder + 1 : 0;

		// Parse optional fields from form data
		const description = formData.get('description')?.toString().trim() || null;
		const notes = formData.get('notes')?.toString().trim() || null;
		const contractorHired = formData.get('contractorHired') === 'on' ? 1 : 0;
		const contractorName = formData.get('contractorName')?.toString().trim() || null;
		const contractorDetails = formData.get('contractorDetails')?.toString().trim() || null;

		// Parse cost field - convert dollars to cents for storage
		const costStr = formData.get('cost')?.toString().trim();
		const cost = costStr ? Math.round(parseFloat(costStr) * 100) : null;

		// Insert the new todo into the database
		await db.insert(todo).values({
			title,
			description,
			notes,
			contractorHired,
			contractorName,
			contractorDetails,
			cost,
			sortOrder: nextSortOrder
		});

		return { success: true };
	},

	/**
	 * Update an existing todo item
	 * Allows partial updates - only provided fields are changed
	 */
	update: async ({ request }) => {
		const formData = await request.formData();
		const id = formData.get('id')?.toString();

		if (!id) {
			return fail(400, { error: 'Todo ID is required' });
		}

		const title = formData.get('title')?.toString().trim();
		if (!title) {
			return fail(400, { error: 'Title is required' });
		}

		// Parse all fields from form data
		const description = formData.get('description')?.toString().trim() || null;
		const notes = formData.get('notes')?.toString().trim() || null;
		const contractorHired = formData.get('contractorHired') === 'on' ? 1 : 0;
		const contractorName = formData.get('contractorName')?.toString().trim() || null;
		const contractorDetails = formData.get('contractorDetails')?.toString().trim() || null;

		const costStr = formData.get('cost')?.toString().trim();
		const cost = costStr ? Math.round(parseFloat(costStr) * 100) : null;

		// Update the todo in the database
		await db
			.update(todo)
			.set({
				title,
				description,
				notes,
				contractorHired,
				contractorName,
				contractorDetails,
				cost,
				updatedAt: Date.now()
			})
			.where(eq(todo.id, id));

		return { success: true };
	},

	/**
	 * Mark a todo as completed
	 * Sets the completed flag to 1
	 */
	complete: async ({ request }) => {
		const formData = await request.formData();
		const id = formData.get('id')?.toString();

		if (!id) {
			return fail(400, { error: 'Todo ID is required' });
		}

		await db.update(todo).set({ completed: 1, updatedAt: Date.now() }).where(eq(todo.id, id));

		return { success: true };
	},

	/**
	 * Restore a completed todo (mark as incomplete)
	 */
	restore: async ({ request }) => {
		const formData = await request.formData();
		const id = formData.get('id')?.toString();

		if (!id) {
			return fail(400, { error: 'Todo ID is required' });
		}

		await db.update(todo).set({ completed: 0, updatedAt: Date.now() }).where(eq(todo.id, id));

		return { success: true };
	},

	/**
	 * Delete a todo item permanently
	 */
	delete: async ({ request }) => {
		const formData = await request.formData();
		const id = formData.get('id')?.toString();

		if (!id) {
			return fail(400, { error: 'Todo ID is required' });
		}

		await db.delete(todo).where(eq(todo.id, id));

		return { success: true };
	},

	/**
	 * Reorder todos - updates sortOrder for all affected items
	 * Called when user drags and drops a todo to a new position
	 */
	reorder: async ({ request }) => {
		const formData = await request.formData();
		const orderJson = formData.get('order')?.toString();

		if (!orderJson) {
			return fail(400, { error: 'Order data is required' });
		}

		try {
			// Parse the order array: [{id: string, sortOrder: number}, ...]
			const order: { id: string; sortOrder: number }[] = JSON.parse(orderJson);

			// Update each todo's sortOrder in parallel for efficiency
			await Promise.all(
				order.map(({ id, sortOrder }) => db.update(todo).set({ sortOrder }).where(eq(todo.id, id)))
			);

			return { success: true };
		} catch (e) {
			return fail(400, { error: 'Invalid order data' });
		}
	}
};
