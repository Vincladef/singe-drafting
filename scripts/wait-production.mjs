const target=process.env.GITHUB_SHA;
for(let attempt=0;attempt<60;attempt++){
  try{const health=await (await fetch('https://singe-drafting.netlify.app/api/health',{signal:AbortSignal.timeout(10000)})).json();if(health.commit===target){console.log('Current commit deployed and database reachable.');process.exit(0);}}catch{}
  await new Promise(resolve=>setTimeout(resolve,10000));
}
throw new Error('The expected Netlify deployment did not become ready within ten minutes.');
