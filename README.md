# sv

Everything you need to build a Svelte project, powered by [`sv`](https://github.com/sveltejs/cli).

## Creating a project

If you're seeing this, you've probably already done this step. Congrats!

```sh
# create a new project
npx sv create my-app
```

To recreate this project with the same configuration:

```sh
# recreate this project
npx sv create --template minimal --types ts --add prettier tailwindcss="plugins:typography,forms" drizzle="database:sqlite+sqlite:better-sqlite3" mcp="ide:vscode+setup:remote" --install npm todo-app
```

## Developing

Once you've created a project and installed dependencies with `npm install` (or `pnpm install` or `yarn`), start a development server:

```sh
npm run dev

# or start the server and open the app in a new browser tab
npm run dev -- --open
```

## Building

To create a production version of your app:

```sh
npm run build
```

You can preview the production build with `npm run preview`.

> To deploy your app, you may need to install an [adapter](https://svelte.dev/docs/kit/adapters) for your target environment.

## Instructions

Build a very simple todo application using the project and installed packages as a starting point. It is important to make the code maintanable by a human with limited nodejs experience - so add comments where things are not perfectly clear.

Features:
- todo items have these properties: 
    - title
    - description (optional)
    - notes (optional)
    - contractor hired? (controles display of the following)
    - contractor name (optional)
    - contractor details (optional)
    - estimated cost (optional)
    - cost (optional)
- sqlite is used as storage
- drag and drop to reorder todo items
- todo items can be edited, completed, or deleted
- multiple views: grid, list, list detail
- provide a very simple client-side search filter
- option to include completed todo items in view (default = false)
- use tailwind css and default to dark mode
- when completing or deleting a todo item, fade out the item
- ability to export a todo item to pdf using pdfmake - documentation is at https://pdfmake.github.io/docs/0.3/
