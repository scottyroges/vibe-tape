# Playlist Feedback Loop

After a vibe playlist gets generated, let the user review it and give thumbs up/down on individual songs to reinforce or steer the vibe.

- Show the generated playlist with a + and - button on each song
- (+) means "yes, this is the vibe" — reinforces that song's influence on the criteria
- (-) means "not quite" — weakens or removes that song's influence
- After giving feedback, the playlist regenerates using the updated signal
- Could iterate multiple rounds until the user is happy with the result

This turns playlist creation from a one-shot generation into a conversational refinement. The user teaches the algorithm what they actually mean by the vibe, rather than hoping the seeds alone capture it perfectly.
