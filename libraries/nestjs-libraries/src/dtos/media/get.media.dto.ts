import { Type, Transform } from 'class-transformer';
import { IsIn, IsOptional, IsNumber, IsString, Min } from 'class-validator';

export class GetMediaDto {
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Transform(({ value }) => parseInt(value, 10))
  page?: number = 1;

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
