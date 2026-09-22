import { Global, Module } from '@nestjs/common';
import { HeygenProvider } from '@gitroom/nestjs-libraries/3rdparties/heygen/heygen.provider';
import { ReelFarmProvider } from '@gitroom/nestjs-libraries/3rdparties/reelfarm/reelfarm.provider';
import { JoinBrandsProvider } from '@gitroom/nestjs-libraries/3rdparties/joinbrands/joinbrands.provider';
import { ThirdPartyManager } from '@gitroom/nestjs-libraries/3rdparties/thirdparty.manager';

@Global()
@Module({
  providers: [
    HeygenProvider,
    ReelFarmProvider,
    JoinBrandsProvider,
    ThirdPartyManager,
  ],
  get exports() {
    return this.providers;
  },
})
export class ThirdPartyModule {}
