<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { flip } from 'svelte/animate';
	import { fade, fly } from 'svelte/transition';

	// Types for our todo items (matching the database schema)
	interface Todo {
		id: string;
		title: string;
		description: string | null;
		notes: string | null;
		contractorHired: number;
		contractorName: string | null;
		contractorDetails: string | null;
		cost: number | null;
		completed: number;
		sortOrder: number;
		createdAt: number;
		updatedAt: number;
	}

	// Page data from server
	let { data } = $props();

	// ============== STATE ==============

	// View mode: 'grid' | 'list' | 'detail'
	let viewMode = $state<'grid' | 'list' | 'detail'>('list');

	// Search filter text (client-side filtering)
	let searchFilter = $state('');

	// Whether to show completed todos (default = false as per requirements)
	let showCompleted = $state(false);

	// Modal state for create/edit forms
	let showModal = $state(false);
	let editingTodo = $state<Todo | null>(null);

	// Form state for contractor hired toggle (controls visibility of contractor fields)
	let formContractorHired = $state(false);

	// Track items being removed for fade-out animation
	let removingIds = $state<Set<string>>(new Set());

	// Drag and drop state
	let draggedItem = $state<Todo | null>(null);
	let dragOverItem = $state<Todo | null>(null);

	// ============== DERIVED VALUES ==============

	// Filter todos based on search text and completed status
	let filteredTodos = $derived.by(() => {
		let todos = data.todos as Todo[];

		// Filter out completed todos unless showCompleted is true
		if (!showCompleted) {
			todos = todos.filter((t) => t.completed === 0);
		}

		// Filter by search text (searches title, description, notes, contractor name)
		if (searchFilter.trim()) {
			const search = searchFilter.toLowerCase();
			todos = todos.filter(
				(t) =>
					t.title.toLowerCase().includes(search) ||
					t.description?.toLowerCase().includes(search) ||
					t.notes?.toLowerCase().includes(search) ||
					t.contractorName?.toLowerCase().includes(search)
			);
		}

		// Sort by sortOrder to maintain drag-drop order
		return todos.sort((a, b) => a.sortOrder - b.sortOrder);
	});

	// ============== HELPER FUNCTIONS ==============

	/**
	 * Format cents to dollars for display
	 * Example: 1234 -> "$12.34"
	 */
	function formatCurrency(cents: number | null): string {
		if (cents === null) return '';
		return new Intl.NumberFormat('en-US', {
			style: 'currency',
			currency: 'USD'
		}).format(cents / 100);
	}

	/**
	 * Convert cents to dollars for input fields
	 */
	function centsToDollars(cents: number | null): string {
		if (cents === null) return '';
		return (cents / 100).toFixed(2);
	}

	/**
	 * Open the modal to create a new todo
	 */
	function openCreateModal() {
		editingTodo = null;
		formContractorHired = false;
		showModal = true;
	}

	/**
	 * Open the modal to edit an existing todo
	 */
	function openEditModal(todo: Todo) {
		editingTodo = todo;
		formContractorHired = todo.contractorHired === 1;
		showModal = true;
	}

	/**
	 * Close the modal
	 */
	function closeModal() {
		showModal = false;
		editingTodo = null;
	}

	/**
	 * Handle the complete/delete action with fade-out animation
	 * Adds the ID to removingIds which triggers the fade transition
	 */
	function handleRemoveWithAnimation(id: string, callback: () => void) {
		removingIds = new Set([...removingIds, id]);
		// Wait for animation to complete before actually removing
		setTimeout(() => {
			callback();
			// Remove from set after action completes
			const newSet = new Set(removingIds);
			newSet.delete(id);
			removingIds = newSet;
		}, 300);
	}

	// ============== DRAG AND DROP ==============

	/**
	 * Called when user starts dragging a todo item
	 */
	function handleDragStart(event: DragEvent, todo: Todo) {
		draggedItem = todo;
		if (event.dataTransfer) {
			event.dataTransfer.effectAllowed = 'move';
			event.dataTransfer.setData('text/plain', todo.id);
		}
	}

	/**
	 * Called when a dragged item is over another item
	 */
	function handleDragOver(event: DragEvent, todo: Todo) {
		event.preventDefault();
		if (draggedItem && draggedItem.id !== todo.id) {
			dragOverItem = todo;
		}
	}

	/**
	 * Called when the drag leaves an item
	 */
	function handleDragLeave() {
		dragOverItem = null;
	}

	/**
	 * Called when user drops an item - reorders the list
	 */
	async function handleDrop(event: DragEvent, targetTodo: Todo) {
		event.preventDefault();

		if (!draggedItem || draggedItem.id === targetTodo.id) {
			draggedItem = null;
			dragOverItem = null;
			return;
		}

		// Create new order by moving dragged item to target position
		const todos = [...filteredTodos];
		const draggedIndex = todos.findIndex((t) => t.id === draggedItem!.id);
		const targetIndex = todos.findIndex((t) => t.id === targetTodo.id);

		// Remove dragged item and insert at target position
		const [removed] = todos.splice(draggedIndex, 1);
		todos.splice(targetIndex, 0, removed);

		// Create new order data for the server
		const order = todos.map((t, index) => ({
			id: t.id,
			sortOrder: index
		}));

		// Submit reorder to server
		const formData = new FormData();
		formData.append('order', JSON.stringify(order));
		await fetch('?/reorder', {
			method: 'POST',
			body: formData
		});

		// Refresh data from server
		await invalidateAll();

		draggedItem = null;
		dragOverItem = null;
	}

	/**
	 * Called when drag ends (cleanup)
	 */
	function handleDragEnd() {
		draggedItem = null;
		dragOverItem = null;
	}

	// ============== PDF EXPORT ==============

	/**
	 * Export a single todo item to PDF using pdfmake
	 * Loads pdfmake dynamically to avoid SSR issues
	 */
	async function exportToPdf(todo: Todo) {
		// Dynamic import of pdfmake (client-side only)
		// Using 'any' types due to pdfmake's complex module structure
		const pdfMakeModule: any = await import('pdfmake/build/pdfmake');
		const pdfFontsModule: any = await import('pdfmake/build/vfs_fonts');

		// Get the actual pdfMake object (handles different bundling scenarios)
		const pdfMake = pdfMakeModule.default || pdfMakeModule;

		// Set up fonts - the font data is embedded in pdfFonts
		const vfs = pdfFontsModule.pdfMake?.vfs || pdfFontsModule.default?.pdfMake?.vfs;
		if (vfs) {
			pdfMake.vfs = vfs;
		}

		// Build the document content
		const content: any[] = [
			{ text: todo.title, style: 'header' },
			{
				text: `Status: ${todo.completed ? 'Completed' : 'Pending'}`,
				style: todo.completed ? 'statusComplete' : 'statusPending'
			},
			// Separator line after header
			{
				canvas: [
					{
						type: 'line',
						x1: 0,
						y1: 5,
						x2: 515,
						y2: 5,
						lineWidth: 1,
						lineColor: '#3B82F6'
					}
				],
				margin: [0, 5, 0, 15] as [number, number, number, number]
			}
		];

		// Add description if present
		if (todo.description) {
			content.push(
				{ text: 'Description', style: 'subheader' },
				{ text: todo.description, style: 'body' }
			);
		}

		// Add notes if present
		if (todo.notes) {
			content.push({ text: 'Notes', style: 'subheader' }, { text: todo.notes, style: 'body' });
		}

		// Add contractor info if hired
		if (todo.contractorHired) {
			content.push({ text: 'Contractor Information', style: 'subheader' });

			if (todo.contractorName) {
				content.push({ text: `Name: ${todo.contractorName}`, style: 'body' });
			}
			if (todo.contractorDetails) {
				content.push({ text: `Details: ${todo.contractorDetails}`, style: 'body' });
			}
		}

		// Add cost information
		if (todo.cost) {
			content.push({ text: 'Total Cost', style: 'subheader' });
			content.push({ text: formatCurrency(todo.cost), style: 'cost' });
		}

		// Add timestamps
		// content.push(
		// 	{ text: 'Timeline', style: 'subheader' },
		// 	{ text: `Created: ${new Date(todo.createdAt).toLocaleDateString()}`, style: 'body' },
		// 	{ text: `Last Updated: ${new Date(todo.updatedAt).toLocaleDateString()}`, style: 'body' }
		// );

		// Create the PDF document definition
		const docDefinition = {
			content,
			styles: {
				header: {
					fontSize: 24,
					bold: true,
					color: '#1E40AF',
					margin: [0, 0, 0, 8] as [number, number, number, number]
				},
				statusComplete: {
					fontSize: 12,
					italics: true,
					color: '#059669',
					margin: [0, 0, 0, 5] as [number, number, number, number]
				},
				statusPending: {
					fontSize: 12,
					italics: true,
					color: '#D97706',
					margin: [0, 0, 0, 5] as [number, number, number, number]
				},
				subheader: {
					fontSize: 14,
					bold: true,
					color: '#4B5563',
					margin: [0, 15, 0, 5] as [number, number, number, number]
				},
				body: {
					fontSize: 11,
					color: '#374151',
					margin: [0, 0, 0, 5] as [number, number, number, number]
				},
				cost: {
					fontSize: 13,
					bold: true,
					color: '#059669',
					margin: [0, 0, 0, 5] as [number, number, number, number]
				}
			},
			footer: {
				stack: [
					{
						text: `Generated by Todo App on ${new Date().toLocaleString()}`,
						alignment: 'center',
						fontSize: 9,
						color: '#9CA3AF'
					},
					{
						text: `${window.location.origin}?id=${todo.id}`,
						link: `${window.location.origin}?id=${todo.id}`,
						alignment: 'center',
						fontSize: 8,
						color: '#3B82F6',
						margin: [0, 2, 0, 0] as [number, number, number, number]
					}
				],
				margin: [0, 10, 0, 0] as [number, number, number, number]
			}
		};

		// Generate and download the PDF
		pdfMake.createPdf(docDefinition).download(`todo-${todo.id}.pdf`);
	}
</script>

<!-- ============== PAGE HEADER ============== -->
<div class="min-h-screen bg-gray-900 p-4 text-gray-100 sm:p-8">
	<div class="mx-auto max-w-6xl">
		<!-- ============== CONTROLS BAR ============== -->
		<div
			class="mb-6 flex flex-col items-start justify-between gap-4 rounded-lg sm:flex-row sm:items-center"
		>
			<!-- Title -->
			<!-- <div>
				<h2 class="text-2xl font-bold text-white">Todos</h2>
			</div> -->

			<!-- Search Input -->
			<div class="relative max-w-md flex-1">
				<svg
					class="absolute top-1/2 left-3 h-5 w-5 -translate-y-1/2 text-gray-400"
					fill="none"
					stroke="currentColor"
					viewBox="0 0 24 24"
				>
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2"
						d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
					/>
				</svg>
				<input
					type="text"
					placeholder="Search todos..."
					bind:value={searchFilter}
					class="w-full rounded-lg border border-gray-600 bg-gray-700 py-2 pr-4 pl-10 text-white placeholder-gray-400 focus:border-transparent focus:ring-2 focus:ring-blue-500"
				/>
			</div>

			<div class="flex flex-wrap items-center gap-4">
				<!-- Show Completed Toggle -->
				<label class="flex cursor-pointer items-center gap-2">
					<input
						type="checkbox"
						bind:checked={showCompleted}
						class="h-4 w-4 rounded border-gray-600 bg-gray-700 text-blue-600 focus:ring-blue-500"
					/>
					<span class="text-sm text-gray-300">Show completed</span>
				</label>

				<!-- View Mode Toggle -->
				<div class="flex rounded-lg bg-gray-700 p-1">
					<button
						onclick={() => (viewMode = 'list')}
						class="rounded px-3 py-1 text-sm transition-colors {viewMode === 'list'
							? 'bg-blue-600 text-white'
							: 'text-gray-400 hover:text-white'}"
						title="List view"
					>
						<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M4 6h16M4 12h16M4 18h16"
							/>
						</svg>
					</button>
					<button
						onclick={() => (viewMode = 'detail')}
						class="rounded px-3 py-1 text-sm transition-colors {viewMode === 'detail'
							? 'bg-blue-600 text-white'
							: 'text-gray-400 hover:text-white'}"
						title="Detail view"
					>
						<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M4 6h16M4 10h16M4 14h16M4 18h16"
							/>
						</svg>
					</button>
					<button
						onclick={() => (viewMode = 'grid')}
						class="rounded px-3 py-1 text-sm transition-colors {viewMode === 'grid'
							? 'bg-blue-600 text-white'
							: 'text-gray-400 hover:text-white'}"
						title="Grid view"
					>
						<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z"
							/>
						</svg>
					</button>
				</div>
			</div>
		</div>

		<!-- ============== TODO LIST ============== -->
		<button
			onclick={openCreateModal}
			class="mb-4 flex w-full items-center gap-4 rounded-lg border border-dashed border-gray-300 bg-gray-800 px-4 py-3 text-gray-500 transition-all hover:border-gray-600 hover:text-gray-400"
		>
			<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
			</svg>
			<span>Add a new todo...</span>
		</button>

		{#if filteredTodos.length === 0}
			<div class="py-12 text-center text-gray-400">
				<svg
					class="mx-auto mb-4 h-16 w-16 opacity-50"
					fill="none"
					stroke="currentColor"
					viewBox="0 0 24 24"
				>
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2"
						d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
					/>
				</svg>
				<p class="text-lg">No todos found</p>
				<p class="mt-2 text-sm">
					{#if searchFilter}
						Try adjusting your search filter
					{:else}
						Click "Add Todo" to create your first item
					{/if}
				</p>
			</div>
		{:else}
			<!-- Grid View -->
			{#if viewMode === 'grid'}
				<div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3" role="list">
					{#each filteredTodos as todo (todo.id)}
						<div
							role="listitem"
							animate:flip={{ duration: 300 }}
							transition:fade={{ duration: 300 }}
							draggable="true"
							ondragstart={(e) => handleDragStart(e, todo)}
							ondragover={(e) => handleDragOver(e, todo)}
							ondragleave={handleDragLeave}
							ondrop={(e) => handleDrop(e, todo)}
							ondragend={handleDragEnd}
							class="cursor-grab rounded-lg border border-gray-700 bg-gray-800 p-4 transition-all hover:border-gray-600 active:cursor-grabbing
								{todo.completed ? 'opacity-60' : ''}
								{removingIds.has(todo.id) ? 'scale-95 opacity-0' : ''}
								{dragOverItem?.id === todo.id ? 'ring-2 ring-blue-500' : ''}"
							style="transition: opacity 0.3s, transform 0.3s;"
						>
							<div class="mb-2 flex items-start justify-between">
								<h3
									class="text-lg font-semibold {todo.completed
										? 'text-gray-500 line-through'
										: 'text-white'}"
								>
									{todo.title}
								</h3>
								<span
									class="rounded-full px-2 py-1 text-xs {todo.completed
										? 'bg-green-900 text-green-300'
										: 'bg-yellow-900 text-yellow-300'}"
								>
									{todo.completed ? 'Done' : 'Pending'}
								</span>
							</div>

							{#if todo.description}
								<p class="mb-3 line-clamp-2 text-sm text-gray-400">{todo.description}</p>
							{/if}

							{#if todo.contractorHired && todo.contractorName}
								<p class="mb-2 text-xs text-gray-500">
									<span class="text-gray-400">Contractor:</span>
									{todo.contractorName}
								</p>
							{/if}

							{#if todo.cost}
								<div class="mb-3 text-xs text-gray-500">
									<span>Total Cost: {formatCurrency(todo.cost)}</span>
								</div>
							{/if}

							<!-- Action Buttons -->
							<div class="mt-auto flex gap-2 border-t border-gray-700 pt-2">
								<button
									onclick={() => openEditModal(todo)}
									class="flex-1 rounded bg-gray-700 px-2 py-1 text-xs transition-colors hover:bg-gray-600"
									title="Edit"
								>
									Edit
								</button>
								{#if todo.completed}
									<form
										method="POST"
										action="?/restore"
										use:enhance={() => {
											return async ({ update }) => {
												await update();
											};
										}}
									>
										<input type="hidden" name="id" value={todo.id} />
										<button
											type="submit"
											class="rounded bg-yellow-600 px-2 py-1 text-xs transition-colors hover:bg-yellow-700"
											title="Restore"
										>
											Restore
										</button>
									</form>
								{:else}
									<form
										method="POST"
										action="?/complete"
										use:enhance={() => {
											handleRemoveWithAnimation(todo.id, () => {});
											return async ({ update }) => {
												await update();
											};
										}}
									>
										<input type="hidden" name="id" value={todo.id} />
										<button
											type="submit"
											class="rounded bg-green-600 px-2 py-1 text-xs transition-colors hover:bg-green-700"
											title="Complete"
										>
											Done
										</button>
									</form>
								{/if}
								<form
									method="POST"
									action="?/delete"
									use:enhance={() => {
										handleRemoveWithAnimation(todo.id, () => {});
										return async ({ update }) => {
											await update();
										};
									}}
								>
									<input type="hidden" name="id" value={todo.id} />
									<button
										type="submit"
										class="rounded bg-red-600 px-2 py-1 text-xs transition-colors hover:bg-red-700"
										title="Delete"
									>
										Delete
									</button>
								</form>
								<button
									onclick={() => exportToPdf(todo)}
									class="rounded bg-purple-600 px-2 py-1 text-xs transition-colors hover:bg-purple-700"
									title="Export to PDF"
								>
									PDF
								</button>
							</div>
						</div>
					{/each}
				</div>
			{/if}

			<!-- List View (Compact) -->
			{#if viewMode === 'list'}
				<div class="space-y-2" role="list">
					{#each filteredTodos as todo (todo.id)}
						<div
							role="listitem"
							animate:flip={{ duration: 300 }}
							transition:fade={{ duration: 300 }}
							draggable="true"
							ondragstart={(e) => handleDragStart(e, todo)}
							ondragover={(e) => handleDragOver(e, todo)}
							ondragleave={handleDragLeave}
							ondrop={(e) => handleDrop(e, todo)}
							ondragend={handleDragEnd}
							class="flex cursor-grab items-center gap-4 rounded-lg border border-gray-700 bg-gray-800 px-4 py-3 transition-all hover:border-gray-600 active:cursor-grabbing
								{todo.completed ? 'opacity-60' : ''}
								{removingIds.has(todo.id) ? 'scale-95 opacity-0' : ''}
								{dragOverItem?.id === todo.id ? 'ring-2 ring-blue-500' : ''}"
							style="transition: opacity 0.3s, transform 0.3s;"
						>
							<!-- Drag Handle -->
							<div class="cursor-grab text-gray-500">
								<svg class="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
									<path
										d="M8 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM8 12a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM8 18a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM14 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM14 12a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM14 18a2 2 0 1 1-4 0 2 2 0 0 1 4 0z"
									/>
								</svg>
							</div>

							<!-- Status Indicator -->
							<div
								class="h-3 w-3 rounded-full {todo.completed ? 'bg-green-500' : 'bg-yellow-500'}"
							></div>

							<!-- Title -->
							<div class="min-w-0 flex-1">
								<h3
									class="truncate font-medium {todo.completed
										? 'text-gray-500 line-through'
										: 'text-white'}"
								>
									{todo.title}
								</h3>
							</div>

							<!-- Cost Badge (if any) -->
							{#if todo.cost}
								<div class="hidden text-xs text-gray-400 sm:block">
									{formatCurrency(todo.cost)}
								</div>
							{/if}

							<!-- Actions -->
							<div class="flex gap-2">
								<button
									onclick={() => openEditModal(todo)}
									class="rounded p-1 transition-colors hover:bg-gray-700"
									title="Edit"
								>
									<svg
										class="h-5 w-5 text-gray-400"
										fill="none"
										stroke="currentColor"
										viewBox="0 0 24 24"
									>
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											stroke-width="2"
											d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
										/>
									</svg>
								</button>
								{#if todo.completed}
									<form
										method="POST"
										action="?/restore"
										use:enhance={() => {
											return async ({ update }) => {
												await update();
											};
										}}
									>
										<input type="hidden" name="id" value={todo.id} />
										<button
											type="submit"
											class="rounded p-1 transition-colors hover:bg-gray-700"
											title="Restore"
										>
											<svg
												class="h-5 w-5 text-yellow-400"
												fill="none"
												stroke="currentColor"
												viewBox="0 0 24 24"
											>
												<path
													stroke-linecap="round"
													stroke-linejoin="round"
													stroke-width="2"
													d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6"
												/>
											</svg>
										</button>
									</form>
								{:else}
									<form
										method="POST"
										action="?/complete"
										use:enhance={() => {
											handleRemoveWithAnimation(todo.id, () => {});
											return async ({ update }) => {
												await update();
											};
										}}
									>
										<input type="hidden" name="id" value={todo.id} />
										<button
											type="submit"
											class="rounded p-1 transition-colors hover:bg-gray-700"
											title="Complete"
										>
											<svg
												class="h-5 w-5 text-green-400"
												fill="none"
												stroke="currentColor"
												viewBox="0 0 24 24"
											>
												<path
													stroke-linecap="round"
													stroke-linejoin="round"
													stroke-width="2"
													d="M5 13l4 4L19 7"
												/>
											</svg>
										</button>
									</form>
								{/if}
								<form
									method="POST"
									action="?/delete"
									use:enhance={() => {
										handleRemoveWithAnimation(todo.id, () => {});
										return async ({ update }) => {
											await update();
										};
									}}
								>
									<input type="hidden" name="id" value={todo.id} />
									<button
										type="submit"
										class="rounded p-1 transition-colors hover:bg-gray-700"
										title="Delete"
									>
										<svg
											class="h-5 w-5 text-red-400"
											fill="none"
											stroke="currentColor"
											viewBox="0 0 24 24"
										>
											<path
												stroke-linecap="round"
												stroke-linejoin="round"
												stroke-width="2"
												d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
											/>
										</svg>
									</button>
								</form>
								<button
									onclick={() => exportToPdf(todo)}
									class="rounded p-1 transition-colors hover:bg-gray-700"
									title="Export to PDF"
								>
									<svg
										class="h-5 w-5 text-purple-400"
										fill="none"
										stroke="currentColor"
										viewBox="0 0 24 24"
									>
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											stroke-width="2"
											d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
										/>
									</svg>
								</button>
							</div>
						</div>
					{/each}
				</div>
			{/if}

			<!-- Detail View (Expanded) -->
			{#if viewMode === 'detail'}
				<div class="space-y-4" role="list">
					{#each filteredTodos as todo (todo.id)}
						<div
							role="listitem"
							animate:flip={{ duration: 300 }}
							transition:fade={{ duration: 300 }}
							draggable="true"
							ondragstart={(e) => handleDragStart(e, todo)}
							ondragover={(e) => handleDragOver(e, todo)}
							ondragleave={handleDragLeave}
							ondrop={(e) => handleDrop(e, todo)}
							ondragend={handleDragEnd}
							class="cursor-grab rounded-lg border border-gray-700 bg-gray-800 p-5 transition-all hover:border-gray-600 active:cursor-grabbing
								{todo.completed ? 'opacity-60' : ''}
								{removingIds.has(todo.id) ? 'scale-95 opacity-0' : ''}
								{dragOverItem?.id === todo.id ? 'ring-2 ring-blue-500' : ''}"
							style="transition: opacity 0.3s, transform 0.3s;"
						>
							<!-- Header -->
							<div class="mb-4 flex items-start justify-between">
								<div class="flex items-center gap-3">
									<!-- Drag Handle -->
									<div class="cursor-grab text-gray-500">
										<svg class="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
											<path
												d="M8 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM8 12a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM8 18a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM14 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM14 12a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM14 18a2 2 0 1 1-4 0 2 2 0 0 1 4 0z"
											/>
										</svg>
									</div>
									<h3
										class="text-xl font-semibold {todo.completed
											? 'text-gray-500 line-through'
											: 'text-white'}"
									>
										{todo.title}
									</h3>
								</div>
								<span
									class="rounded-full px-3 py-1 text-sm {todo.completed
										? 'bg-green-900 text-green-300'
										: 'bg-yellow-900 text-yellow-300'}"
								>
									{todo.completed ? 'Completed' : 'Pending'}
								</span>
							</div>

							<!-- Content Grid -->
							<div class="mb-4 grid grid-cols-1 gap-4 md:grid-cols-2">
								<!-- Description -->
								{#if todo.description}
									<div>
										<h4 class="mb-1 text-sm font-medium text-gray-400">Description</h4>
										<p class="text-gray-300">{todo.description}</p>
									</div>
								{/if}

								<!-- Notes -->
								{#if todo.notes}
									<div>
										<h4 class="mb-1 text-sm font-medium text-gray-400">Notes</h4>
										<p class="text-gray-300">{todo.notes}</p>
									</div>
								{/if}

								<!-- Contractor Info (only shown if contractor is hired) -->
								{#if todo.contractorHired}
									<div class="rounded-lg bg-gray-700/50 p-3 md:col-span-2">
										<h4 class="mb-2 text-sm font-medium text-gray-400">Contractor Information</h4>
										<div class="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
											{#if todo.contractorName}
												<div>
													<span class="text-gray-500">Name:</span>
													<span class="ml-2 text-gray-300">{todo.contractorName}</span>
												</div>
											{/if}
											{#if todo.contractorDetails}
												<div>
													<span class="text-gray-500">Details:</span>
													<span class="ml-2 text-gray-300">{todo.contractorDetails}</span>
												</div>
											{/if}
										</div>
									</div>
								{/if}

								<!-- Cost (always visible if set) -->
								{#if todo.cost}
									<div class="md:col-span-2">
										<h4 class="mb-2 text-sm font-medium text-gray-400">Total Cost</h4>
										<div class="text-sm">
											<span class="text-gray-300">{formatCurrency(todo.cost)}</span>
										</div>
									</div>
								{/if}
							</div>

							<!-- Footer with timestamp and actions -->
							<div
								class="flex flex-col items-start justify-between gap-3 border-t border-gray-700 pt-4 sm:flex-row sm:items-center"
							>
								<div class="text-xs text-gray-500">
									Created: {new Date(todo.createdAt).toLocaleDateString()} • Updated: {new Date(
										todo.updatedAt
									).toLocaleDateString()}
								</div>
								<div class="flex gap-2">
									<button
										onclick={() => openEditModal(todo)}
										class="rounded bg-gray-700 px-3 py-1.5 text-sm transition-colors hover:bg-gray-600"
									>
										Edit
									</button>
									{#if todo.completed}
										<form
											method="POST"
											action="?/restore"
											use:enhance={() => {
												return async ({ update }) => {
													await update();
												};
											}}
										>
											<input type="hidden" name="id" value={todo.id} />
											<button
												type="submit"
												class="rounded bg-yellow-600 px-3 py-1.5 text-sm transition-colors hover:bg-yellow-700"
											>
												Restore
											</button>
										</form>
									{:else}
										<form
											method="POST"
											action="?/complete"
											use:enhance={() => {
												handleRemoveWithAnimation(todo.id, () => {});
												return async ({ update }) => {
													await update();
												};
											}}
										>
											<input type="hidden" name="id" value={todo.id} />
											<button
												type="submit"
												class="rounded bg-green-600 px-3 py-1.5 text-sm transition-colors hover:bg-green-700"
											>
												Complete
											</button>
										</form>
									{/if}
									<form
										method="POST"
										action="?/delete"
										use:enhance={() => {
											handleRemoveWithAnimation(todo.id, () => {});
											return async ({ update }) => {
												await update();
											};
										}}
									>
										<input type="hidden" name="id" value={todo.id} />
										<button
											type="submit"
											class="rounded bg-red-600 px-3 py-1.5 text-sm transition-colors hover:bg-red-700"
										>
											Delete
										</button>
									</form>
									<button
										onclick={() => exportToPdf(todo)}
										class="rounded bg-purple-600 px-3 py-1.5 text-sm transition-colors hover:bg-purple-700"
									>
										Export PDF
									</button>
								</div>
							</div>
						</div>
					{/each}
				</div>
			{/if}
		{/if}
	</div>
</div>

<!-- ============== CREATE/EDIT MODAL ============== -->
{#if showModal}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
		transition:fade={{ duration: 200 }}
		onclick={(e) => {
			if (e.target === e.currentTarget) closeModal();
		}}
		onkeydown={(e) => {
			if (e.key === 'Escape') closeModal();
		}}
		role="dialog"
		aria-modal="true"
		tabindex="-1"
	>
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
		<div
			class="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-gray-800 p-6"
			transition:fly={{ y: 50, duration: 300 }}
			onclick={(e) => e.stopPropagation()}
			onkeydown={(e) => e.stopPropagation()}
			role="document"
		>
			<div class="mb-6 flex items-center justify-between">
				<h2 class="text-xl font-semibold text-white">
					{editingTodo ? 'Edit Todo' : 'Create New Todo'}
				</h2>
				<button
					onclick={closeModal}
					class="text-gray-400 transition-colors hover:text-white"
					aria-label="Close modal"
				>
					<svg class="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M6 18L18 6M6 6l12 12"
						/>
					</svg>
				</button>
			</div>

			<form
				method="POST"
				action={editingTodo ? '?/update' : '?/create'}
				use:enhance={() => {
					return async ({ update }) => {
						await update();
						closeModal();
					};
				}}
				class="space-y-4"
			>
				{#if editingTodo}
					<input type="hidden" name="id" value={editingTodo.id} />
				{/if}

				<!-- Title (Required) -->
				<div>
					<label for="title" class="mb-1 block text-sm font-medium text-gray-300">
						Title <span class="text-red-400">*</span>
					</label>
					<input
						type="text"
						id="title"
						name="title"
						required
						value={editingTodo?.title ?? ''}
						class="w-full rounded-lg border border-gray-600 bg-gray-700 px-3 py-2 text-white focus:border-transparent focus:ring-2 focus:ring-blue-500"
						placeholder="What needs to be done?"
					/>
				</div>

				<!-- Description (Optional) -->
				<div>
					<label for="description" class="mb-1 block text-sm font-medium text-gray-300">
						Description
					</label>
					<textarea
						id="description"
						name="description"
						rows="2"
						class="w-full resize-none rounded-lg border border-gray-600 bg-gray-700 px-3 py-2 text-white focus:border-transparent focus:ring-2 focus:ring-blue-500"
						placeholder="Add more details...">{editingTodo?.description ?? ''}</textarea
					>
				</div>

				<!-- Notes (Optional) -->
				<div>
					<label for="notes" class="mb-1 block text-sm font-medium text-gray-300"> Notes </label>
					<textarea
						id="notes"
						name="notes"
						rows="2"
						class="w-full resize-none rounded-lg border border-gray-600 bg-gray-700 px-3 py-2 text-white focus:border-transparent focus:ring-2 focus:ring-blue-500"
						placeholder="Any additional notes...">{editingTodo?.notes ?? ''}</textarea
					>
				</div>

				<!-- Contractor Hired Toggle -->
				<div class="border-t border-gray-700 pt-4">
					<label class="flex cursor-pointer items-center gap-3">
						<input
							type="checkbox"
							id="contractorHired"
							name="contractorHired"
							bind:checked={formContractorHired}
							class="h-5 w-5 rounded border-gray-600 bg-gray-700 text-blue-600 focus:ring-blue-500"
						/>
						<span class="text-gray-300">Contractor Hired</span>
					</label>
				</div>

				<!-- Contractor Fields (only shown when contractor is hired) -->
				{#if formContractorHired}
					<div class="space-y-4 border-l-2 border-gray-700 pl-4" id="contractor-fields">
						<div>
							<label for="contractorName" class="mb-1 block text-sm font-medium text-gray-300">
								Contractor Name
							</label>
							<input
								type="text"
								id="contractorName"
								name="contractorName"
								value={editingTodo?.contractorName ?? ''}
								class="w-full rounded-lg border border-gray-600 bg-gray-700 px-3 py-2 text-white focus:border-transparent focus:ring-2 focus:ring-blue-500"
								placeholder="Enter contractor name"
							/>
						</div>
						<div>
							<label for="contractorDetails" class="mb-1 block text-sm font-medium text-gray-300">
								Contractor Details
							</label>
							<textarea
								id="contractorDetails"
								name="contractorDetails"
								rows="2"
								class="w-full resize-none rounded-lg border border-gray-600 bg-gray-700 px-3 py-2 text-white focus:border-transparent focus:ring-2 focus:ring-blue-500"
								placeholder="Phone, email, notes about contractor..."
								>{editingTodo?.contractorDetails ?? ''}</textarea
							>
						</div>
					</div>
				{/if}

				<!-- Cost Field -->
				<div class="border-t border-gray-700 pt-4">
					<label for="cost" class="mb-1 block text-sm font-medium text-gray-300"> Cost </label>
					<div class="relative max-w-xs">
						<span class="absolute top-1/2 left-3 -translate-y-1/2 text-gray-400">$</span>
						<input
							type="number"
							id="cost"
							name="cost"
							step="0.01"
							min="0"
							value={centsToDollars(editingTodo?.cost ?? null)}
							class="w-full rounded-lg border border-gray-600 bg-gray-700 py-2 pr-3 pl-7 text-white focus:border-transparent focus:ring-2 focus:ring-blue-500"
							placeholder="0.00"
						/>
					</div>
				</div>

				<!-- Form Actions -->
				<div class="flex gap-3 border-t border-gray-700 pt-4">
					<button
						type="button"
						onclick={closeModal}
						class="flex-1 rounded-lg bg-gray-700 px-4 py-2 font-medium transition-colors hover:bg-gray-600"
					>
						Cancel
					</button>
					<button
						type="submit"
						class="flex-1 rounded-lg bg-blue-600 px-4 py-2 font-medium transition-colors hover:bg-blue-700"
					>
						{editingTodo ? 'Save Changes' : 'Create Todo'}
					</button>
				</div>
			</form>
		</div>
	</div>
{/if}

<style>
	/* Line clamp utility for truncating text in grid view */
	.line-clamp-2 {
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
</style>
