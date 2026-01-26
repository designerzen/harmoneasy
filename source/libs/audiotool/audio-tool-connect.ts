import { createAudiotoolClient } from "@audiotool/nexus"
import type { AudiotoolClient, SyncedDocument } from "@audiotool/nexus"
import { log } from '../log.ts'
// @ts-ignore
import { AUDIOTOOL_STORAGE_KEYS } from './audio-tool-settings.ts'
// @ts-ignore
import { edoScaleMicroTuningOctave } from "../pitfalls/edo.mjs"
// @ts-ignore
import { microTuningOctave } from "../pitfalls/audioToolInt.mjs"

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
    log('Creating Audiotool client...');
    const result = await createAudiotoolClient({
      pat: patToken,
    });
    client = result;
    console.log(result);
    log('Client created successfully!');
    (document.querySelector('.project-section') as HTMLDivElement).style.display = 'block';
  } catch (error) {
    log('Error creating client: ' + (error as Error).message);
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
      log('Please connect first');
      return;
    }
    log('Connecting to project ...');

    // Create synced document
    nexus = await client.createSyncedDocument({
      mode: "online",
      project: projectUrl,
    });

    log('Connected to project...');

    // Log initial entity counts
    const allEntities = nexus.queryEntities.get();
    log(`Total entities in project: ${allEntities.length}`);

    // Log entity type breakdown
    const entityTypes: Record<string, number> = {};
    allEntities.forEach(entity => {
      const type = entity.type;
      entityTypes[type] = (entityTypes[type] || 0) + 1;
    });

    log('Entity breakdown:');
    Object.entries(entityTypes).forEach(([type, count]) => {
      log(`  ${type}: ${count}`);
    });

    // Get note tracks and check for notes
    let noteTracks = nexus.queryEntities.ofTypes("noteTrack").get();
    log(`Found ${noteTracks.length} note tracks`);

    if (noteTracks.length > 0) {
      // Get all notes in the project
      const allNotes = nexus.queryEntities.ofTypes("note").get();
      log(`Found ${allNotes.length} total notes in project`);

      // Log details of each note
      allNotes.forEach((note, index) => {
        log(`Note ${index + 1}: Pitch=${note.fields.pitch.value}, Position=${note.fields.positionTicks.value}t, Duration=${note.fields.durationTicks.value}t, Velocity=${note.fields.velocity.value}`);
      });
    }

    // Set up event listeners
    nexus.events.onCreate("tonematrix", (tm) => {
      log(`New tonematrix created! Pattern index: ${tm.fields.patternIndex.value}`);
    });

    nexus.events.onCreate("stompboxDelay", (delay) => {
      log(`New delay effect created! Feedback: ${delay.fields.feedbackFactor.value}`);
    });

    nexus.events.onCreate("noteTrack", (track) => {
      log(`New note track created! Order: ${track.fields.orderAmongTracks.value}`);
    });

    // Start syncing
    await nexus.start();
    microtonalTuning = await microTuningOctave(nexus, pitches);
    console.log(microtonalTuning);
    noteTracks = nexus.queryEntities.ofTypes("noteTrack").get();
    log(`Found ${noteTracks.length} note tracks`);

    if (noteTracks.length > 0) {
      // Get all notes in the project
      const allNotes = nexus.queryEntities.ofTypes("note").get();
      log(`Found ${allNotes.length} total notes in project`);

      // Log details of each note
      allNotes.forEach((note, index) => {
        log(`Note ${index + 1}: Pitch=${note.fields.pitch.value}, Position=${note.fields.positionTicks.value}t, Duration=${note.fields.durationTicks.value}t, Velocity=${note.fields.velocity.value}`);
      });
    }
    log('Project connected and syncing started!');
    (document.querySelector('.controls-section') as HTMLDivElement).style.display = 'block';

  } catch (error) {
    log('Error connecting to project: ' + (error as Error).message);
    throw error;
  }
}

// Business logic functions
export const handleConnectWithPAT = async (patToken: string): Promise<void> => {
  if (!patToken) {
    log('Please enter a PAT token')
    return;
  }

  try {
    log('Initializing client with PAT token...');
    await initializeClient(patToken);

    // Save token to localStorage
    localStorage.setItem(AUDIOTOOL_STORAGE_KEYS.PAT_TOKEN, patToken);
    log('PAT token saved to localStorage');

    log('Client initialized successfully!');
  } catch (error) {
    log('Error initializing client: ' + (error as Error).message);
  }
}

/**
 * 
 * @returns 
 */
export const handleListProjects = async (): Promise<void> => {
  if (!client) {
    log('Please connect first');
    return;
  }

  try {
    const projects = await client.api.projectService.listProjects({});

    // Check if the result is an error or a successful response
    if (projects instanceof Error) {
      log('Error listing projects: ' + projects.message);
      return;
    } else {
      // Cast to ListProjectsResponse and proceed
      const projectsResponse = projects;
      const projectsArray = (projectsResponse as any).projects || projectsResponse;
      log(`Found ${Array.isArray(projectsArray) ? projectsArray.length : 0} projects:`);
      console.log(projectsArray);
      if (Array.isArray(projectsArray)) {
        projectsArray.forEach((project: any) => {
          log(`  - ${project.fields?.name?.value || project.name}`);
        });
      } else {
        log('Projects response is not in expected format');
        console.log('Projects response:', projectsResponse);
      }
    }
  } catch (error) {
    log('Error listing projects and tunings: ' + (error as Error).message);
  }
}

/**
 * 
 * @param selectedProject 
 * @returns 
 */
export const handleOpenSelectedProject = async (selectedProject: string): Promise<void> => {
  if (!selectedProject) {
    log('Please select a project');
    return;
  }

  const projectUrl = `https://beta.audiotool.com/studio?project=${selectedProject.split('/')[1]}`;
  (document.getElementById('project-url') as HTMLInputElement).value = projectUrl;

  // Trigger the existing open project logic
  document.getElementById('open-project-btn')!.click();
}

/**
 * 
 * @param projectUrl 
 * @returns 
 */
export const handleOpenProject = async (projectUrl: string): Promise<void> => {
  if (!projectUrl) {
    log('Please enter a project URL');
    return;
  }

  if (!client) {
    log('Please connect first');
    return;
  }

  try {
    log('Connecting to project...');

    // Save project URL to localStorage immediately when attempting to connect
    localStorage.setItem(AUDIOTOOL_STORAGE_KEYS.PROJECT_URL, projectUrl);
    log('Project URL saved to localStorage');

    await connectToNexusProject(projectUrl);
  } catch (error) {
    log('Error connecting to project: ' + (error as Error).message);
  }
}

/**
 * 
 * @returns 
 */
export const handleQueryDevices = async (): Promise<void> => {
  if (!nexus) {
    log('Please connect to a project first');
    return;
  }

  try {
    // Find all delay effects
    const delays = nexus.queryEntities.ofTypes("stompboxDelay").get();
    log(`Found ${delays.length} delay effects`);

    // Find all tonematrixes
    const tonematrixes = nexus.queryEntities.ofTypes("tonematrix").get();
    log(`Found ${tonematrixes.length} tonematrixes`);

    // Find all note tracks
    const noteTracks = nexus.queryEntities.ofTypes("noteTrack").get();
    log(`Found ${noteTracks.length} note tracks`);

    log('Query completed!');
  } catch (error) {
    log('Error querying devices: ' + (error as Error).message);
  }
}

/**
 * 
 * @returns 
 */
export const handleCreateNoteTrack = async (): Promise<void> => {
  if (!nexus) {
    log('Please connect to a project first');
    return;
  }

  try {
    // First, try to find an existing device to connect to
    const devices = nexus.queryEntities.ofTypes("tonematrix").get();

    if (devices.length === 0) {
      log('No devices found. Create a tonematrix first!');
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

    log(`Created note track with ID: ${result.noteTrack.id}`);
    log(`Created note region with ID: ${result.noteRegion.id}`);
  } catch (error) {
    log('Error creating note track: ' + (error as Error).message);
  }
}

/**
 * 
 */
export const handleClearToken = (): void => {
  localStorage.removeItem(AUDIOTOOL_STORAGE_KEYS.PAT_TOKEN);
  (document.getElementById('pat-input') as HTMLInputElement).value = '';
  log('Stored PAT token cleared');
}

/**
 * 
 * @returns 
 */
export const handleAutoConnect = async (): Promise<void> => {
  const savedToken = localStorage.getItem(AUDIOTOOL_STORAGE_KEYS.PAT_TOKEN);
  const savedProjectUrl = localStorage.getItem(AUDIOTOOL_STORAGE_KEYS.PROJECT_URL);

  if (!savedToken) {
    log('No stored PAT token found. Please enter a token and connect first.');
    return;
  }

  if (!savedProjectUrl) {
    log('No stored project URL found. Please enter a project URL and connect first.');
    return;
  }

  log('Starting auto-connect with stored values...');

  try {
    // Initialize client if needed
    if (!client) {
      try {
        log('Creating Audiotool client with stored PAT...');
        await initializeClient(savedToken);

        log('Client initialized successfully!');
      } catch (error) {
        log('Error initializing client: ' + (error as Error).message);
      }
    }

    log('Client ready for project connection!');

    // Connect to project
    log('Connecting to stored project...');

    await connectToNexusProject(savedProjectUrl);

    log('Auto-connect completed successfully!');

  } catch (error) {
    log('Error during auto-connect: ' + (error as Error).message);
  }
}

/**
 * 
 * @returns 
 */
export const handleListNotes = (): Promise<void> => {
  if (!nexus) {
    log('Please connect to a project first');
    return;
  }

  try {
    // Find all note tracks
    const noteTracks = nexus.queryEntities.ofTypes("noteTrack").get();
    log(`Found ${noteTracks.length} note tracks`);

    // Find all note regions
    const noteRegions = nexus.queryEntities.ofTypes("noteRegion").get();
    log(`Found ${noteRegions.length} note regions`);

    // Find all note collections
    const noteCollections = nexus.queryEntities.ofTypes("noteCollection").get();
    log(`Found ${noteCollections.length} note collections`);

    // Find all individual notes
    const notes = nexus.queryEntities.ofTypes("note").get();
    log(`Found ${notes.length} individual notes`);

    // Log details of each note
    notes.forEach((note, index) => {
      log(`Note ${index + 1}: Pitch=${note.fields.pitch.value} (MIDI), Position=${note.fields.positionTicks.value} ticks, Duration=${note.fields.durationTicks.value} ticks, Velocity=${note.fields.velocity.value}`);
    });

  } catch (error) {
    log('Error listing notes: ' + (error as Error).message);
  }
}

/**
 * 
 * @returns 
 */
export const handleCreateNote = async (): Promise<void> => {
  if (!nexus) {
    log('Please connect to a project first');
    return;
  }

  try {
    // Find an existing note collection to add the note to
    const noteCollections = nexus.queryEntities.ofTypes("noteCollection").get();

    if (noteCollections.length === 0) {
      log('No note collections found. Create a note track first!');
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

    log(`Created note with ID: ${note.id}, Pitch: ${note.fields.pitch.value}, Position: ${note.fields.positionTicks.value} ticks`);

  } catch (error) {
    log('Error creating note: ' + (error as Error).message);
  }
}