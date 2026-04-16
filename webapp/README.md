# Live Speech-to-Text Webapp

Minimal Node.js + browser webapp for live microphone transcription with ElevenLabs Realtime Speech-to-Text.

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create your env file:

   ```bash
   cp .env.example .env
   ```

3. Set the required keys and shared login credentials in `.env`:

   - `ELEVENLABS_API_KEY`
   - `GEMINI_API_KEY`
   - `AUTH_USERNAME`
   - `AUTH_PASSWORD`
   - `AUTH_SESSION_SECRET`

4. Start the app:

   ```bash
   npm run dev
   ```

5. Open [http://localhost:3000](http://localhost:3000), sign in with the shared dispatcher username and password, and you will be redirected to `/dispatcher`.

## Notes

- The server creates a single-use `realtime_scribe` token at `/scribe-token` using `@elevenlabs/elevenlabs-js`.
- The frontend never receives your ElevenLabs API key directly.
- `/` is the login page, `/dispatcher` is the protected dispatcher app, and `/physicians-portal/` is the protected physician portal.
- The dispatcher app and physician portal share the same signed-cookie login session.
- The client streams mono 16-bit PCM audio to ElevenLabs at 16kHz, which matches ElevenLabs' recommended realtime STT format.

## References

- ElevenLabs client-side realtime STT guide: <https://elevenlabs.io/docs/eleven-api/guides/how-to/speech-to-text/realtime/client-side-streaming>
- ElevenLabs realtime STT API reference: <https://elevenlabs.io/docs/api-reference/speech-to-text/v-1-speech-to-text-realtime>
- ElevenLabs realtime transcript/commit guide: <https://elevenlabs.io/docs/eleven-api/guides/how-to/speech-to-text/realtime/transcripts-and-commit-strategies>
