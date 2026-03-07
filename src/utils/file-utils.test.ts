import { describe, it } from 'vitest';

describe('File utils tests', { timeout: 100_000_000 }, () => {
  it('Can download a file', async () => {
    // await FileUtils.downloadFile('https://download.jetbrains.com/webstorm/WebStorm-2025.3.1-aarch64.dmg?_gl=1*1huoi7o*_gcl_aw*R0NMLjE3NjU3NDAwMTcuQ2p3S0NBaUEzZm5KQmhBZ0Vpd0F5cW1ZNVhLVENlbHJOcTk2YXdjZVlfMS1wdE91MXc0WDk2bFJkVDM3QURhUFNJMUtwNVVSVUhxWTJob0NuZ0FRQXZEX0J3RQ..*_gcl_au*MjA0MDQ0MjE2My4xNzYzNjQzNzMz*FPAU*MjA0MDQ0MjE2My4xNzYzNjQzNzMz*_ga*MTYxMDg4MTkzMi4xNzYzNjQzNzMz*_ga_9J976DJZ68*czE3NjYzNjI5ODAkbzEyJGcxJHQxNzY2MzYzMDQwJGo2MCRsMCRoMA..', path.join(process.cwd(), 'google.html'));
  })
})
