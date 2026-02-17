<script lang="ts">
	import { enhance } from '$app/forms';
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
			todos = todos.filter(t => t.completed === 0);
		}
		
		// Filter by search text (searches title, description, notes, contractor name)
		if (searchFilter.trim()) {
			const search = searchFilter.toLowerCase();
			todos = todos.filter(t => 
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
		const draggedIndex = todos.findIndex(t => t.id === draggedItem!.id);
		const targetIndex = todos.findIndex(t => t.id === targetTodo.id);
		
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
			{ text: `Status: ${todo.completed ? 'Completed' : 'Pending'}`, style: 'status' }
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
			content.push(
				{ text: 'Notes', style: 'subheader' },
				{ text: todo.notes, style: 'body' }
			);
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
			content.push({ text: 'Cost Information', style: 'subheader' });
			content.push({ text: `Actual: ${formatCurrency(todo.cost)}`, style: 'body' });
		}

		// Add timestamps
		content.push(
			{ text: 'Timeline', style: 'subheader' },
			{ text: `Created: ${new Date(todo.createdAt).toLocaleDateString()}`, style: 'body' },
			{ text: `Last Updated: ${new Date(todo.updatedAt).toLocaleDateString()}`, style: 'body' }
		);

		// Create the PDF document definition
		const docDefinition = {
			content,
			styles: {
				header: {
					fontSize: 22,
					bold: true,
					margin: [0, 0, 0, 10] as [number, number, number, number]
				},
				status: {
					fontSize: 12,
					italics: true,
					margin: [0, 0, 0, 20] as [number, number, number, number]
				},
				subheader: {
					fontSize: 14,
					bold: true,
					margin: [0, 15, 0, 5] as [number, number, number, number]
				},
				body: {
					fontSize: 11,
					margin: [0, 0, 0, 5] as [number, number, number, number]
				}
			}
		};

		// Generate and download the PDF
		pdfMake.createPdf(docDefinition).download(`todo-${todo.id}.pdf`);
	}
</script>

<!-- ============== PAGE HEADER ============== -->
<div class="min-h-screen bg-gray-900 text-gray-100 p-4 sm:p-8">
	<div class="max-w-6xl mx-auto">
		<!-- Title and Add Button -->
		<div class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
			<h1 class="text-3xl font-bold text-white">Todo List</h1>
			<button
				onclick={openCreateModal}
				class="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg font-medium transition-colors flex items-center gap-2"
			>
				<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
				</svg>
				Add Todo
			</button>
		</div>

		<!-- ============== CONTROLS BAR ============== -->
		<div class="bg-gray-800 rounded-lg p-4 mb-6 flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
			<!-- Search Input -->
			<div class="relative flex-1 max-w-md">
				<svg class="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
				</svg>
				<input
					type="text"
					placeholder="Search todos..."
					bind:value={searchFilter}
					class="w-full pl-10 pr-4 py-2 bg-gray-700 border border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-white placeholder-gray-400"
				/>
			</div>

			<div class="flex flex-wrap gap-4 items-center">
				<!-- Show Completed Toggle -->
				<label class="flex items-center gap-2 cursor-pointer">
					<input
						type="checkbox"
						bind:checked={showCompleted}
						class="w-4 h-4 rounded border-gray-600 bg-gray-700 text-blue-600 focus:ring-blue-500"
					/>
					<span class="text-sm text-gray-300">Show completed</span>
				</label>

				<!-- View Mode Toggle -->
				<div class="flex bg-gray-700 rounded-lg p-1">
					<button
						onclick={() => viewMode = 'list'}
						class="px-3 py-1 rounded text-sm transition-colors {viewMode === 'list' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'}"
						title="List view"
					>
						<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" />
						</svg>
					</button>
					<button
						onclick={() => viewMode = 'detail'}
						class="px-3 py-1 rounded text-sm transition-colors {viewMode === 'detail' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'}"
						title="Detail view"
					>
						<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 10h16M4 14h16M4 18h16" />
						</svg>
					</button>
					<button
						onclick={() => viewMode = 'grid'}
						class="px-3 py-1 rounded text-sm transition-colors {viewMode === 'grid' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'}"
						title="Grid view"
					>
						<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
						</svg>
					</button>
				</div>
			</div>
		</div>

		<!-- ============== TODO LIST ============== -->
		{#if filteredTodos.length === 0}
			<div class="text-center py-12 text-gray-400">
				<svg class="w-16 h-16 mx-auto mb-4 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
				</svg>
				<p class="text-lg">No todos found</p>
				<p class="text-sm mt-2">
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
				<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4" role="list">
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
							class="bg-gray-800 rounded-lg p-4 border border-gray-700 hover:border-gray-600 transition-all cursor-grab active:cursor-grabbing
								{todo.completed ? 'opacity-60' : ''}
								{removingIds.has(todo.id) ? 'opacity-0 scale-95' : ''}
								{dragOverItem?.id === todo.id ? 'ring-2 ring-blue-500' : ''}"
							style="transition: opacity 0.3s, transform 0.3s;"
						>
							<div class="flex justify-between items-start mb-2">
								<h3 class="font-semibold text-lg {todo.completed ? 'line-through text-gray-500' : 'text-white'}">
									{todo.title}
								</h3>
								<span class="text-xs px-2 py-1 rounded-full {todo.completed ? 'bg-green-900 text-green-300' : 'bg-yellow-900 text-yellow-300'}">
									{todo.completed ? 'Done' : 'Pending'}
								</span>
							</div>
							
							{#if todo.description}
								<p class="text-gray-400 text-sm mb-3 line-clamp-2">{todo.description}</p>
							{/if}

							{#if todo.contractorHired && todo.contractorName}
								<p class="text-xs text-gray-500 mb-2">
									<span class="text-gray-400">Contractor:</span> {todo.contractorName}
								</p>
							{/if}

							{#if todo.cost}
								<div class="text-xs text-gray-500 mb-3">
									<span>Actual: {formatCurrency(todo.cost)}</span>
								</div>
							{/if}

							<!-- Action Buttons -->
							<div class="flex gap-2 mt-auto pt-2 border-t border-gray-700">
								<button
									onclick={() => openEditModal(todo)}
									class="flex-1 text-xs py-1 px-2 bg-gray-700 hover:bg-gray-600 rounded transition-colors"
									title="Edit"
								>
									Edit
								</button>
								{#if todo.completed}
									<form method="POST" action="?/restore" use:enhance={() => {
										return async ({ update }) => {
											await update();
										};
									}}>
										<input type="hidden" name="id" value={todo.id} />
										<button type="submit" class="text-xs py-1 px-2 bg-yellow-600 hover:bg-yellow-700 rounded transition-colors" title="Restore">
											Restore
										</button>
									</form>
								{:else}
									<form method="POST" action="?/complete" use:enhance={() => {
										handleRemoveWithAnimation(todo.id, () => {});
										return async ({ update }) => {
											await update();
										};
									}}>
										<input type="hidden" name="id" value={todo.id} />
										<button type="submit" class="text-xs py-1 px-2 bg-green-600 hover:bg-green-700 rounded transition-colors" title="Complete">
											Done
										</button>
									</form>
								{/if}
								<form method="POST" action="?/delete" use:enhance={() => {
									handleRemoveWithAnimation(todo.id, () => {});
									return async ({ update }) => {
										await update();
									};
								}}>
									<input type="hidden" name="id" value={todo.id} />
									<button type="submit" class="text-xs py-1 px-2 bg-red-600 hover:bg-red-700 rounded transition-colors" title="Delete">
										Delete
									</button>
								</form>
								<button
									onclick={() => exportToPdf(todo)}
									class="text-xs py-1 px-2 bg-purple-600 hover:bg-purple-700 rounded transition-colors"
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
							class="bg-gray-800 rounded-lg px-4 py-3 border border-gray-700 hover:border-gray-600 transition-all cursor-grab active:cursor-grabbing flex items-center gap-4
								{todo.completed ? 'opacity-60' : ''}
								{removingIds.has(todo.id) ? 'opacity-0 scale-95' : ''}
								{dragOverItem?.id === todo.id ? 'ring-2 ring-blue-500' : ''}"
							style="transition: opacity 0.3s, transform 0.3s;"
						>
							<!-- Drag Handle -->
							<div class="text-gray-500 cursor-grab">
								<svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
									<path d="M8 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM8 12a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM8 18a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM14 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM14 12a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM14 18a2 2 0 1 1-4 0 2 2 0 0 1 4 0z" />
								</svg>
							</div>

							<!-- Status Indicator -->
							<div class="w-3 h-3 rounded-full {todo.completed ? 'bg-green-500' : 'bg-yellow-500'}"></div>

							<!-- Title -->
							<div class="flex-1 min-w-0">
								<h3 class="font-medium truncate {todo.completed ? 'line-through text-gray-500' : 'text-white'}">
									{todo.title}
								</h3>
							</div>

							<!-- Cost Badge (if any) -->
							{#if todo.cost}
								<div class="hidden sm:block text-xs text-gray-400">
									{formatCurrency(todo.cost)}
								</div>
							{/if}

							<!-- Actions -->
							<div class="flex gap-2">
								<button
									onclick={() => openEditModal(todo)}
									class="p-1 hover:bg-gray-700 rounded transition-colors"
									title="Edit"
								>
									<svg class="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
										<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
									</svg>
								</button>
								{#if todo.completed}
									<form method="POST" action="?/restore" use:enhance={() => {
										return async ({ update }) => { await update(); };
									}}>
										<input type="hidden" name="id" value={todo.id} />
										<button type="submit" class="p-1 hover:bg-gray-700 rounded transition-colors" title="Restore">
											<svg class="w-5 h-5 text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
												<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
											</svg>
										</button>
									</form>
								{:else}
									<form method="POST" action="?/complete" use:enhance={() => {
										handleRemoveWithAnimation(todo.id, () => {});
										return async ({ update }) => { await update(); };
									}}>
										<input type="hidden" name="id" value={todo.id} />
										<button type="submit" class="p-1 hover:bg-gray-700 rounded transition-colors" title="Complete">
											<svg class="w-5 h-5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
												<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
											</svg>
										</button>
									</form>
								{/if}
								<form method="POST" action="?/delete" use:enhance={() => {
									handleRemoveWithAnimation(todo.id, () => {});
									return async ({ update }) => { await update(); };
								}}>
									<input type="hidden" name="id" value={todo.id} />
									<button type="submit" class="p-1 hover:bg-gray-700 rounded transition-colors" title="Delete">
										<svg class="w-5 h-5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
											<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
										</svg>
									</button>
								</form>
								<button
									onclick={() => exportToPdf(todo)}
									class="p-1 hover:bg-gray-700 rounded transition-colors"
									title="Export to PDF"
								>
									<svg class="w-5 h-5 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
										<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
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
							class="bg-gray-800 rounded-lg p-5 border border-gray-700 hover:border-gray-600 transition-all cursor-grab active:cursor-grabbing
								{todo.completed ? 'opacity-60' : ''}
								{removingIds.has(todo.id) ? 'opacity-0 scale-95' : ''}
								{dragOverItem?.id === todo.id ? 'ring-2 ring-blue-500' : ''}"
							style="transition: opacity 0.3s, transform 0.3s;"
						>
							<!-- Header -->
							<div class="flex justify-between items-start mb-4">
								<div class="flex items-center gap-3">
									<!-- Drag Handle -->
									<div class="text-gray-500 cursor-grab">
										<svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
											<path d="M8 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM8 12a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM8 18a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM14 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM14 12a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM14 18a2 2 0 1 1-4 0 2 2 0 0 1 4 0z" />
										</svg>
									</div>
									<h3 class="text-xl font-semibold {todo.completed ? 'line-through text-gray-500' : 'text-white'}">
										{todo.title}
									</h3>
								</div>
								<span class="text-sm px-3 py-1 rounded-full {todo.completed ? 'bg-green-900 text-green-300' : 'bg-yellow-900 text-yellow-300'}">
									{todo.completed ? 'Completed' : 'Pending'}
								</span>
							</div>

							<!-- Content Grid -->
							<div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
								<!-- Description -->
								{#if todo.description}
									<div>
										<h4 class="text-sm font-medium text-gray-400 mb-1">Description</h4>
										<p class="text-gray-300">{todo.description}</p>
									</div>
								{/if}

								<!-- Notes -->
								{#if todo.notes}
									<div>
										<h4 class="text-sm font-medium text-gray-400 mb-1">Notes</h4>
										<p class="text-gray-300">{todo.notes}</p>
									</div>
								{/if}

								<!-- Contractor Info (only shown if contractor is hired) -->
								{#if todo.contractorHired}
									<div class="md:col-span-2 bg-gray-700/50 rounded-lg p-3">
										<h4 class="text-sm font-medium text-gray-400 mb-2">Contractor Information</h4>
										<div class="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
											{#if todo.contractorName}
												<div>
													<span class="text-gray-500">Name:</span>
													<span class="text-gray-300 ml-2">{todo.contractorName}</span>
												</div>
											{/if}
											{#if todo.contractorDetails}
												<div>
													<span class="text-gray-500">Details:</span>
													<span class="text-gray-300 ml-2">{todo.contractorDetails}</span>
												</div>
											{/if}

										</div>
									</div>
								{/if}

								<!-- Cost (always visible if set) -->
								{#if todo.cost}
									<div class="md:col-span-2">
										<h4 class="text-sm font-medium text-gray-400 mb-2">Cost</h4>
										<div class="text-sm">
											<span class="text-gray-300">{formatCurrency(todo.cost)}</span>
										</div>
									</div>
								{/if}
							</div>

							<!-- Footer with timestamp and actions -->
							<div class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 pt-4 border-t border-gray-700">
								<div class="text-xs text-gray-500">
									Created: {new Date(todo.createdAt).toLocaleDateString()} • 
									Updated: {new Date(todo.updatedAt).toLocaleDateString()}
								</div>
								<div class="flex gap-2">
									<button
										onclick={() => openEditModal(todo)}
										class="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-sm transition-colors"
									>
										Edit
									</button>
									{#if todo.completed}
										<form method="POST" action="?/restore" use:enhance={() => {
											return async ({ update }) => { await update(); };
										}}>
											<input type="hidden" name="id" value={todo.id} />
											<button type="submit" class="px-3 py-1.5 bg-yellow-600 hover:bg-yellow-700 rounded text-sm transition-colors">
												Restore
											</button>
										</form>
									{:else}
										<form method="POST" action="?/complete" use:enhance={() => {
											handleRemoveWithAnimation(todo.id, () => {});
											return async ({ update }) => { await update(); };
										}}>
											<input type="hidden" name="id" value={todo.id} />
											<button type="submit" class="px-3 py-1.5 bg-green-600 hover:bg-green-700 rounded text-sm transition-colors">
												Complete
											</button>
										</form>
									{/if}
									<form method="POST" action="?/delete" use:enhance={() => {
										handleRemoveWithAnimation(todo.id, () => {});
										return async ({ update }) => { await update(); };
									}}>
										<input type="hidden" name="id" value={todo.id} />
										<button type="submit" class="px-3 py-1.5 bg-red-600 hover:bg-red-700 rounded text-sm transition-colors">
											Delete
										</button>
									</form>
									<button
										onclick={() => exportToPdf(todo)}
										class="px-3 py-1.5 bg-purple-600 hover:bg-purple-700 rounded text-sm transition-colors"
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
		class="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50"
		transition:fade={{ duration: 200 }}
		onclick={(e) => { if (e.target === e.currentTarget) closeModal(); }}
		onkeydown={(e) => { if (e.key === 'Escape') closeModal(); }}
		role="dialog"
		aria-modal="true"
		tabindex="-1"
	>
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
		<div
			class="bg-gray-800 rounded-xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto"
			transition:fly={{ y: 50, duration: 300 }}
			onclick={(e) => e.stopPropagation()}
			onkeydown={(e) => e.stopPropagation()}
			role="document"
		>
			<div class="flex justify-between items-center mb-6">
				<h2 class="text-xl font-semibold text-white">
					{editingTodo ? 'Edit Todo' : 'Create New Todo'}
				</h2>
				<button
					onclick={closeModal}
					class="text-gray-400 hover:text-white transition-colors"
					aria-label="Close modal"
				>
					<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
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
					<label for="title" class="block text-sm font-medium text-gray-300 mb-1">
						Title <span class="text-red-400">*</span>
					</label>
					<input
						type="text"
						id="title"
						name="title"
						required
						value={editingTodo?.title ?? ''}
						class="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-white"
						placeholder="What needs to be done?"
					/>
				</div>

				<!-- Description (Optional) -->
				<div>
					<label for="description" class="block text-sm font-medium text-gray-300 mb-1">
						Description
					</label>
					<textarea
						id="description"
						name="description"
						rows="2"
						class="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-white resize-none"
						placeholder="Add more details..."
					>{editingTodo?.description ?? ''}</textarea>
				</div>

				<!-- Notes (Optional) -->
				<div>
					<label for="notes" class="block text-sm font-medium text-gray-300 mb-1">
						Notes
					</label>
					<textarea
						id="notes"
						name="notes"
						rows="2"
						class="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-white resize-none"
						placeholder="Any additional notes..."
					>{editingTodo?.notes ?? ''}</textarea>
				</div>

				<!-- Contractor Hired Toggle -->
				<div class="border-t border-gray-700 pt-4">
					<label class="flex items-center gap-3 cursor-pointer">
						<input
							type="checkbox"
							id="contractorHired"
							name="contractorHired"
							bind:checked={formContractorHired}
							class="w-5 h-5 rounded border-gray-600 bg-gray-700 text-blue-600 focus:ring-blue-500"
						/>
						<span class="text-gray-300">Contractor Hired</span>
					</label>
				</div>

				<!-- Contractor Fields (only shown when contractor is hired) -->
				{#if formContractorHired}
				<div class="space-y-4 pl-4 border-l-2 border-gray-700" id="contractor-fields">
					<div>
						<label for="contractorName" class="block text-sm font-medium text-gray-300 mb-1">
							Contractor Name
						</label>
						<input
							type="text"
							id="contractorName"
							name="contractorName"
							value={editingTodo?.contractorName ?? ''}
							class="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-white"
							placeholder="Enter contractor name"
						/>
					</div>
					<div>
						<label for="contractorDetails" class="block text-sm font-medium text-gray-300 mb-1">
							Contractor Details
						</label>
						<textarea
							id="contractorDetails"
							name="contractorDetails"
							rows="2"
							class="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-white resize-none"
							placeholder="Phone, email, notes about contractor..."
						>{editingTodo?.contractorDetails ?? ''}</textarea>
					</div>
				</div>
				{/if}

				<!-- Cost Field -->
				<div class="border-t border-gray-700 pt-4">
					<label for="cost" class="block text-sm font-medium text-gray-300 mb-1">
						Cost
					</label>
					<div class="relative max-w-xs">
						<span class="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">$</span>
						<input
							type="number"
							id="cost"
							name="cost"
							step="0.01"
							min="0"
							value={centsToDollars(editingTodo?.cost ?? null)}
							class="w-full pl-7 pr-3 py-2 bg-gray-700 border border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-white"
							placeholder="0.00"
						/>
					</div>
				</div>

				<!-- Form Actions -->
				<div class="flex gap-3 pt-4 border-t border-gray-700">
					<button
						type="button"
						onclick={closeModal}
						class="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg font-medium transition-colors"
					>
						Cancel
					</button>
					<button
						type="submit"
						class="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg font-medium transition-colors"
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
