

export const microTuningOctave = async function (nexus, pitches) {
  if (!nexus) {
    console.log('Please connect to a project first');
    return;
  }
  try {
    console.log(`Creating microtonal tuning with alternating cents offset...`);

    const cents = Array.from(pitches.octaveTuning.values());
    console.log(pitches.octaveTuning);
    console.log(`Tuning pattern: [${cents.join(', ')}] cents`);

    const microTuning = await nexus.modify((t) => {
      return t.create("microTuningOctave", {
        cents: cents
      });
    });

    console.log(`Created MicroTuningOctave with ID: ${microTuning.id}`);
    return microTuning;
  } catch (error) {
    console.log('Error creating microtonal tuning: ' + error.message);
    return;
  }
}