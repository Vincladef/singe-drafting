import { collect } from '../../server/ingest.ts';
import { db,status } from '../../server/db.ts';

// Platform-signed deploy event: no public endpoint or user-controlled trigger.
export default {
  async deploySucceeded(){
    const start=Date.now();let imported=0;
    while(Date.now()-start<8*60000){
      const count=await db()`select count(*)::int as n from drafting.matches`;
      if(count[0].n>=180)break;
      const result=await collect(5,true);imported+=result.imported;
      if(result.reason&&['RIOT_401','RIOT_403','RIOT_503','no_seed_puuid','catalog_unavailable','IMPORT_FAILED'].includes(result.reason))break;
      if(result.reason==='RIOT_429')await new Promise(resolve=>setTimeout(resolve,30000));
      else if(result.reason)await new Promise(resolve=>setTimeout(resolve,1000));
    }
    await status('bootstrap','complete',{imported,maximumTarget:180});
  }
};
