import { handleAutoConnect, handleClearToken, handleConnectWithPAT, handleCreateNote, handleCreateNoteTrack, handleListNotes, handleListProjects, handleOpenProject, handleOpenSelectedProject, handleQueryDevices } from './audio-tool-connect.ts';
import { AUDIOTOOL_STORAGE_KEYS } from './audio-tool-settings.ts'

// Initialize the app
document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <details>
    <summary>Connect to Audiotool</summary>
  
    <div class="card">
      <div class="auth-section">
        <h3>Authentication</h3>
        <input type="text" id="pat-input" placeholder="Enter your PAT token (at_pat_...)" />
        <button id="connect-btn">Connect</button>
        <button id="clear-token-btn">Clear Stored Token</button>
        <button id="auto-connect-btn">Auto Connect & Open Project</button>
      </div>
      
      <div class="project-section" style="display: none;">
        <h3>Project Connection</h3>
        <button id="list-projects-btn">List My Projects</button>
        <div id="projects-list" style="display: none;">
          <h4>Select a Project:</h4>
          <select id="project-select" style="width: 100%; margin: 0.5em 0;">
            <option value="">Choose a project...</option>
          </select>
          <button id="open-selected-project-btn">Open Selected Project</button>
        </div>
        <div style="margin-top: 1em;">
          <input type="text" id="project-url" placeholder="Or enter project URL manually" />
          <button id="open-project-btn">Open Project</button>
          <button id="clear-project-btn">Clear Stored URL</button>
        </div>
      </div>
      
      <div class="controls-section" style="display: none;">
        <h3>Audio Device Controls</h3>
        <button id="query-devices-btn">Query All Devices</button>
        <button id="create-note-track-btn">Create Note Track</button>
        <button id="list-notes-btn">List Notes in Project</button>
        <button id="create-note-btn">Create Note</button>
      </div>
      
      <div class="output-section">
        <h3>Output</h3>
        <pre id="output"></pre>
      </div>
    </div>
  </details>
`

// Connect with PAT token
document.getElementById('connect-btn')!.addEventListener('click', async () => {
  const patToken = (document.getElementById('pat-input') as HTMLInputElement).value.trim();
  await handleConnectWithPAT(patToken);
});

// List microtonal tunings
document.getElementById('list-projects-btn')!.addEventListener('click', async () => {
  await handleListProjects();
});

// Open selected project
document.getElementById('open-selected-project-btn')!.addEventListener('click', async () => {
  const selectedProject = (document.getElementById('project-select') as HTMLSelectElement).value;
  await handleOpenSelectedProject(selectedProject);
});

// Open project and start syncing
document.getElementById('open-project-btn')!.addEventListener('click', async () => {
  const projectUrl = (document.getElementById('project-url') as HTMLInputElement).value.trim();
  await handleOpenProject(projectUrl);
});

// Query all devices
document.getElementById('query-devices-btn')!.addEventListener('click', async () => {
  await handleQueryDevices();
});

// Create note track
document.getElementById('create-note-track-btn')!.addEventListener('click', async () => {
  await handleCreateNoteTrack();
});

// Clear stored token
document.getElementById('clear-token-btn')!.addEventListener('click', () => {
  handleClearToken();
});

// Auto connect and open project using stored values
document.getElementById('auto-connect-btn')!.addEventListener('click', async () => {
  await handleAutoConnect();
});

// List notes in project
document.getElementById('list-notes-btn')!.addEventListener('click', async () => {
  await handleListNotes();
});

// Create a new note
document.getElementById('create-note-btn')!.addEventListener('click', async () => {
  await handleCreateNote();
});
