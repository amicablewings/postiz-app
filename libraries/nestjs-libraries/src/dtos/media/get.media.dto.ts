import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class GetMediaDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @IsString()
  search?: string;

  // Customer id, or "none" for media that is not used by a branded channel.
  @IsOptional()
  @IsString()
  brand?: string;

  @IsOptional()
  @IsIn(['image', 'video'])
  type?: 'image' | 'video';

  @IsOptional()
  @IsIn(['newest', 'oldest', 'name'])
  sort?: 'newest' | 'oldest' | 'name';
}
