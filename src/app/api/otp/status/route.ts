import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getSpotterSessionId } from '@/lib/spotter-session';
import { getReporterIdentity, isPhoneVerificationRequired, isTwilioVerifyConfigured } from '@/lib/reporter-verification';
export const dynamic='force-dynamic';
export async function GET(request:NextRequest){
  const spotterId=getSpotterSessionId(request);
  if(!spotterId)return NextResponse.json({error:'Secure browser session required.'},{status:401,headers:{'Cache-Control':'no-store'}});
  const sql=getDb();
  if(!sql)return NextResponse.json({configured:isTwilioVerifyConfigured(),required:isPhoneVerificationRequired(),verified:false,phoneMasked:null},{headers:{'Cache-Control':'no-store'}});
  try{
    const rows=await sql`select i.phone_masked from public.spotter_reporter_links l join public.reporter_identities i on i.id=l.reporter_id where l.spotter_id=${spotterId}::uuid limit 1`;
    return NextResponse.json({configured:isTwilioVerifyConfigured(),required:isPhoneVerificationRequired(),verified:rows.length>0,phoneMasked:(rows[0] as {phone_masked:string}|undefined)?.phone_masked??null},{headers:{'Cache-Control':'no-store'}});
  }catch(error){console.error('OTP status query failed',error);return NextResponse.json({error:'Phone verification status is temporarily unavailable.'},{status:503});}
}
