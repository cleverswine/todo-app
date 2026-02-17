import adapter from '@sveltejs/adapter-node';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	kit: {
		// Using adapter-node for Docker deployment
		// This produces a Node.js server that can run in a container
		adapter: adapter({
			// Output directory for the built server
			out: 'build'
		})
	}
};

export default config;
