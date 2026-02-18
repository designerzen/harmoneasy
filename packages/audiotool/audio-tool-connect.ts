import { createAudiotoolClient } from "@audiotool/nexus"
// @ts-ignore
import { AUDIOTOOL_STORAGE_KEYS } from './audio-tool-settings.ts'
// @ts-ignore
import { edoScaleMicroTuningOctave } from "../pitfalls/edo.mjs"
// @ts-ignore
import { microTuningOctave } from "../pitfalls/audioToolInt.mjs"

import type { AudiotoolClient, SyncedDocument } from "@audiotool/nexus"

// Global variables
let client: AudiotoolClient | null = null
let nexus: SyncedDocument | null = null
let baseNoteMidi = 60;
let rootOctave = 3;
let microtonalTuning = null;
let pitches = edoScaleMicroTuningOctave(baseNoteMidi, rootOctave, "LLsLLL", 3, 1);
console.log(pitches.octaveTuning);

/**
 * Initialize client and set up authentication
 * @param patToken 
 */
export const initializeClient = async (patToken: string): Promise<void> => {
  try {
    console.log('Creating Audiotool client...');
    const result = await createAudiotoolClient({
      pat: patToken,
    });
    client = result;
    console.console.log(result);
    console.log('Client created successfully!');
    (document.querySelector('.project-section') as HTMLDivElement).style.display = 'block';
  } catch (error) {
    console.log('Error creating client: ' + (error as Error).message);
  }
}

/**
 * Connect to nexus project and analyze
 * @param projectUrl 
 * @returns 
 */
export const connectToNexusProject = async (projectUrl: string): Promise<void> => {
  try {
    if (!client) {
      console.log('Please connect first');
      return;
    }
    console.log('Connecting to project ...');

    // Create synced document
    nexus = await client.createSyncedDocument({
      mode: "online",
      project: projectUrl,
    });

    console.log('Connected to project...');

    // console.log initial entity counts
    const allEntities = nexus.queryEntities.get();
    console.log(`Total entities in project: ${allEntities.length}`);

    // console.log entity type breakdown
    const entityTypes: Record<string, number> = {};
    allEntities.forEach(entity => {
      const type = entity.type;
      entityTypes[type] = (entityTypes[type] || 0) + 1;
    });

    console.log('Entity breakdown:');
    Object.entries(entityTypes).forEach(([type, count]) => {
      console.log(`  ${type}: ${count}`);
    });

    // Get note tracks and check for notes
    let noteTracks = nexus.queryEntities.ofTypes("noteTrack").get();
    console.log(`Found ${noteTracks.length} note tracks`);

    if (noteTracks.length > 0) {
      // Get all notes in the project
      const allNotes = nexus.queryEntities.ofTypes("note").get();
      console.log(`Found ${allNotes.length} total notes in project`);

      // console.log details of each note
      allNotes.forEach((note, index) => {
        console.log(`Note ${index + 1}: Pitch=${note.fields.pitch.value}, Position=${note.fields.positionTicks.value}t, Duration=${note.fields.durationTicks.value}t, Velocity=${note.fields.velocity.value}`);
      });
    }

    // Set up event listeners
    nexus.events.onCreate("tonematrix", (tm) => {
      console.log(`New tonematrix created! Pattern index: ${tm.fields.patternIndex.value}`);
    });

    nexus.events.onCreate("stompboxDelay", (delay) => {
      console.log(`New delay effect created! Feedback: ${delay.fields.feedbackFactor.value}`);
    });

    nexus.events.onCreate("noteTrack", (track) => {
      console.log(`New note track created! Order: ${track.fields.orderAmongTracks.value}`);
    });

    // Start syncing
    await nexus.start();
    microtonalTuning = await microTuningOctave(nexus, pitches);
    console.console.log(microtonalTuning);
    noteTracks = nexus.queryEntities.ofTypes("noteTrack").get();
    console.log(`Found ${noteTracks.length} note tracks`);

    if (noteTracks.length > 0) {
      // Get all notes in the project
      const allNotes = nexus.queryEntities.ofTypes("note").get();
      console.log(`Found ${allNotes.length} total notes in project`);

      // console.log details of each note
      allNotes.forEach((note, index) => {
        console.log(`Note ${index + 1}: Pitch=${note.fields.pitch.value}, Position=${note.fields.positionTicks.value}t, Duration=${note.fields.durationTicks.value}t, Velocity=${note.fields.velocity.value}`);
      });
    }
    console.log('Project connected and syncing started!');
    (document.querySelector('.controls-section') as HTMLDivElement).style.display = 'block';

  } catch (error) {
    console.log('Error connecting to project: ' + (error as Error).message);
    throw error;
  }
}

// Business console.logic functions
export const handleConnectWithPAT = async (patToken: string): Promise<void> => {
  if (!patToken) {
    console.log('Please enter a PAT token')
    return;
  }

  try {
    console.log('Initializing client with PAT token...');
    await initializeClient(patToken);

    // Save token to localStorage
    localStorage.setItem(AUDIOTOOL_STORAGE_KEYS.PAT_TOKEN, patToken);
    console.log('PAT token saved to localStorage');

    console.log('Client initialized successfully!');
  } catch (error) {
    console.log('Error initializing client: ' + (error as Error).message);
  }
}

/**
 * 
 * @returns 
 */
export const handleListProjects = async (): Promise<void> => {
  if (!client) {
    console.log('Please connect first');
    return;
  }

  try {
    const projects = await client.api.projectService.listProjects({});

    // Check if the result is an error or a successful response
    if (projects instanceof Error) {
      console.log('Error listing projects: ' + projects.message);
      return;
    } else {
      // Cast to ListProjectsResponse and proceed
      const projectsResponse = projects;
      const projectsArray = (projectsResponse as any).projects || projectsResponse;
      console.log(`Found ${Array.isArray(projectsArray) ? projectsArray.length : 0} projects:`);
      console.console.log(projectsArray);
      if (Array.isArray(projectsArray)) {
        projectsArray.forEach((project: any) => {
          console.log(`  - ${project.fields?.name?.value || project.name}`);
        });
      } else {
        console.log('Projects response is not in expected format');
        console.console.log('Projects response:', projectsResponse);
      }
    }
  } catch (error) {
    console.log('Error listing projects and tunings: ' + (error as Error).message);
  }
}

/**
 * 
 * @param selectedProject 
 * @returns 
 */
export const handleOpenSelectedProject = async (selectedProject: string): Promise<void> => {
  if (!selectedProject) {
    console.log('Please select a project');
    return;
  }

  const projectUrl = `https://beta.audiotool.com/studio?project=${selectedProject.split('/')[1]}`;
  (document.getElementById('project-url') as HTMLInputElement).value = projectUrl;

  // Trigger the existing open project console.logic
  document.getElementById('open-project-btn')!.click();
}

/**
 * 
 * @param projectUrl 
 * @returns 
 */
export const handleOpenProject = async (projectUrl: string): Promise<void> => {
  if (!projectUrl) {
    console.log('Please enter a project URL');
    return;
  }

  if (!client) {
    console.log('Please connect first');
    return;
  }

  try {
    console.log('Connecting to project...');

    // Save project URL to localStorage immediately when attempting to connect
    localStorage.setItem(AUDIOTOOL_STORAGE_KEYS.PROJECT_URL, projectUrl);
    console.log('Project URL saved to localStorage');

    await connectToNexusProject(projectUrl);
  } catch (error) {
    console.log('Error connecting to project: ' + (error as Error).message);
  }
}

/**
 * 
 * @returns 
 */
export const handleQueryDevices = async (): Promise<void> => {
  if (!nexus) {
    console.log('Please connect to a project first');
    return;
  }

  try {
    // Find all delay effects
    const delays = nexus.queryEntities.ofTypes("stompboxDelay").get();
    console.log(`Found ${delays.length} delay effects`);

    // Find all tonematrixes
    const tonematrixes = nexus.queryEntities.ofTypes("tonematrix").get();
    console.log(`Found ${tonematrixes.length} tonematrixes`);

    // Find all note tracks
    const noteTracks = nexus.queryEntities.ofTypes("noteTrack").get();
    console.log(`Found ${noteTracks.length} note tracks`);

    console.log('Query completed!');
  } catch (error) {
    console.log('Error querying devices: ' + (error as Error).message);
  }
}

/**
 * 
 * @returns 
 */
export const handleCreateNoteTrack = async (): Promise<void> => {
  if (!nexus) {
    console.log('Please connect to a project first');
    return;
  }

  try {
    // First, try to find an existing device to connect to
    const devices = nexus.queryEntities.ofTypes("tonematrix").get();

    if (devices.length === 0) {
      console.log('No devices found. Create a tonematrix first!');
      return;
    }

    const device = devices[0];

    const result = await nexus.modify((t) => {
      // Create a note track
      const noteTrack = t.create("noteTrack", {
        orderAmongTracks: 0,
        player: device.location,
      });

      // Add a note region
      const noteRegion = t.create("noteRegion", {
        track: noteTrack.location,
        region: {
          positionTicks: 15360, // One 1/4 note in a 4/4 bar
          durationTicks: 15360 * 4,
        },
      });

      return { noteTrack, noteRegion };
    });

    console.log(`Created note track with ID: ${result.noteTrack.id}`);
    console.log(`Created note region with ID: ${result.noteRegion.id}`);
  } catch (error) {
    console.log('Error creating note track: ' + (error as Error).message);
  }
}

/**
 * 
 */
export const handleClearToken = (): void => {
  localStorage.removeItem(AUDIOTOOL_STORAGE_KEYS.PAT_TOKEN);
  (document.getElementById('pat-input') as HTMLInputElement).value = '';
  console.log('Stored PAT token cleared');
}

/**
 * 
 * @returns 
 */
export const handleAutoConnect = async (): Promise<void> => {
  const savedToken = localStorage.getItem(AUDIOTOOL_STORAGE_KEYS.PAT_TOKEN);
  const savedProjectUrl = localStorage.getItem(AUDIOTOOL_STORAGE_KEYS.PROJECT_URL);

  if (!savedToken) {
    console.log('No stored PAT token found. Please enter a token and connect first.');
    return;
  }

  if (!savedProjectUrl) {
    console.log('No stored project URL found. Please enter a project URL and connect first.');
    return;
  }

  console.log('Starting auto-connect with stored values...');

  try {
    // Initialize client if needed
    if (!client) {
      try {
        console.log('Creating Audiotool client with stored PAT...');
        await initializeClient(savedToken);

        console.log('Client initialized successfully!');
      } catch (error) {
        console.log('Error initializing client: ' + (error as Error).message);
      }
    }

    console.log('Client ready for project connection!');

    // Connect to project
    console.log('Connecting to stored project...');

    await connectToNexusProject(savedProjectUrl);

    console.log('Auto-connect completed successfully!');

  } catch (error) {
    console.log('Error during auto-connect: ' + (error as Error).message);
  }
}

/**
 * 
 * @returns 
 */
export const handleListNotes = (): Promise<void> => {
  if (!nexus) {
    console.log('Please connect to a project first');
    return;
  }

  try {
    // Find all note tracks
    const noteTracks = nexus.queryEntities.ofTypes("noteTrack").get();
    console.log(`Found ${noteTracks.length} note tracks`);

    // Find all note regions
    const noteRegions = nexus.queryEntities.ofTypes("noteRegion").get();
    console.log(`Found ${noteRegions.length} note regions`);

    // Find all note collections
    const noteCollections = nexus.queryEntities.ofTypes("noteCollection").get();
    console.log(`Found ${noteCollections.length} note collections`);

    // Find all individual notes
    const notes = nexus.queryEntities.ofTypes("note").get();
    console.log(`Found ${notes.length} individual notes`);

    // console.log details of each note
    notes.forEach((note, index) => {
      console.log(`Note ${index + 1}: Pitch=${note.fields.pitch.value} (MIDI), Position=${note.fields.positionTicks.value} ticks, Duration=${note.fields.durationTicks.value} ticks, Velocity=${note.fields.velocity.value}`);
    });

  } catch (error) {
    console.log('Error listing notes: ' + (error as Error).message);
  }
}

/**
 * 
 * @returns 
 */
export const handleCreateNote = async (): Promise<void> => {
  if (!nexus) {
    console.log('Please connect to a project first');
    return;
  }

  try {
    // Find an existing note collection to add the note to
    const noteCollections = nexus.queryEntities.ofTypes("noteCollection").get();

    if (noteCollections.length === 0) {
      console.log('No note collections found. Create a note track first!');
      return;
    }

    const noteCollection = noteCollections[0];

    const note = await nexus.modify((t) => {
      return t.create("note", {
        noteCollection: noteCollection.location,
        pitch: 60 + Math.floor(Math.random() * 24), // C4 to B5
        positionTicks: Math.floor(Math.random() * 15360 * 4), // Random position in 4 bars
        durationTicks: 960, // Quarter note
        velocity: 0.7,
        slide: false
      });
    });

    console.log(`Created note with ID: ${note.id}, Pitch: ${note.fields.pitch.value}, Position: ${note.fields.positionTicks.value} ticks`);

  } catch (error) {
    console.log('Error creating note: ' + (error as Error).message);
  }
}