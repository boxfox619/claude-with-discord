import { config } from "dotenv";

// pm2 restart --update-env 를 Claude Code 세션 안에서 실행하면 그 세션의
// ANTHROPIC_API_KEY / CLAUDECODE 등이 봇 환경에 섞여 들어온다.
// .env 를 단일 진실 소스로 삼기 위해 override 로 읽고, 상속된 세션 변수는 제거한다.
for (const key of Object.keys(process.env)) {
  if (key === "CLAUDECODE" || key === "CLAUDE_PID" || key === "CLAUDE_EFFORT" || /^CLAUDE_CODE_(SESSION|CHILD|MESSAGING|ENTRYPOINT|EXECPATH)/.test(key)) {
    delete process.env[key];
  }
}
delete process.env.ANTHROPIC_API_KEY;
config({ override: true });
